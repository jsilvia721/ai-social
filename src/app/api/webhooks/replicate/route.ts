/**
 * POST /api/webhooks/replicate
 *
 * Handles Replicate prediction completion webhooks.
 * Verifies Standard Webhooks signature, processes completed/failed predictions.
 *
 * This endpoint is unauthenticated (no session) — authentication is via
 * webhook signature verification. Middleware exempts /api/webhooks/*.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { prisma } from "@/lib/db";
import { verifyReplicateWebhook } from "@/lib/webhook";
import { processCompletedPrediction } from "@/lib/video";
import { reportServerError } from "@/lib/server-error-reporter";
import type { BriefWithRelations } from "@/lib/video";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
}

// ── Route Handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = env.REPLICATE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // Read raw body for accurate signature verification
  const rawBody = await request.text();

  // Verify Standard Webhooks signature
  const verification = verifyReplicateWebhook(
    rawBody,
    {
      "webhook-id": request.headers.get("webhook-id"),
      "webhook-timestamp": request.headers.get("webhook-timestamp"),
      "webhook-signature": request.headers.get("webhook-signature"),
    },
    secret
  );

  if (!verification.valid) {
    return NextResponse.json(
      { error: verification.error },
      { status: 401 }
    );
  }

  // Parse the verified body
  let prediction: ReplicatePrediction;
  try {
    prediction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Ignore non-terminal statuses (starting, processing)
  if (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    return NextResponse.json({ status: "ignored" });
  }

  // Handle failed/canceled predictions
  if (prediction.status === "failed" || prediction.status === "canceled") {
    try {
      const brief = await prisma.contentBrief.findUnique({
        where: { replicatePredictionId: prediction.id },
      });
      if (brief && (brief.status === "RENDERING" || brief.status === "FULFILLING")) {
        await prisma.contentBrief.update({
          where: { id: brief.id },
          data: {
            status: "FAILED",
            errorMessage: prediction.error ?? `Prediction ${prediction.status}`,
          },
        });
      }
    } catch (err) {
      await reportServerError("Webhook: failed to mark brief as FAILED", {
        url: "/api/webhooks/replicate",
        metadata: { predictionId: prediction.id, error: prediction.error },
      });
    }
    return NextResponse.json({ status: "processed" });
  }

  // Handle succeeded predictions
  // Extract output URL — Replicate returns a single URL string or array
  const outputUrl = Array.isArray(prediction.output)
    ? prediction.output[0]
    : prediction.output;

  if (!outputUrl || typeof outputUrl !== "string") {
    await reportServerError("Webhook: prediction succeeded but no output URL", {
      url: "/api/webhooks/replicate",
      metadata: { predictionId: prediction.id },
    });
    return NextResponse.json({ error: "No output URL in prediction" }, { status: 400 });
  }

  // Atomic idempotency: claim the brief by transitioning RENDERING → FULFILLING
  // If no rows updated, the prediction was already processed or is being processed
  const claimed = await prisma.contentBrief.updateMany({
    where: {
      replicatePredictionId: prediction.id,
      status: "RENDERING",
    },
    data: { status: "FULFILLING" },
  });

  if (claimed.count === 0) {
    // Already processed or concurrent delivery — return 200 (idempotent)
    return NextResponse.json({ status: "already_processed" });
  }

  // Fetch the full brief with relations for processing
  const brief = await prisma.contentBrief.findUnique({
    where: { replicatePredictionId: prediction.id },
    include: {
      business: {
        include: {
          contentStrategy: true,
          socialAccounts: true,
        },
      },
    },
  });

  if (!brief) {
    // Should not happen since we just updated it, but handle gracefully
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  const result = await processCompletedPrediction(
    brief as BriefWithRelations,
    outputUrl
  );

  return NextResponse.json({
    status: result.outcome,
    postId: result.postId,
    error: result.error,
  });
}
