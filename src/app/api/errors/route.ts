import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { normalizeMessage } from "@/lib/normalize-error";
import { checkRateLimit } from "@/lib/rate-limit";

const ERRORS_RATE_LIMIT = { maxRequests: 10, windowMs: 60_000 };

const errorReportSchema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(10000).optional(),
  source: z.enum(["SERVER", "CLIENT"]),
  url: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "anonymous";

  const rateResult = checkRateLimit(`errors:${ip}`, ERRORS_RATE_LIMIT);
  if (!rateResult.allowed) {
    const retryAfterSeconds = Math.ceil(rateResult.retryAfterMs / 1000);
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      }
    );
  }

  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = errorReportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const { message, stack, source, url, metadata } = parsed.data;

  const fingerprint = crypto
    .createHash("sha256")
    .update(source + ":" + normalizeMessage(message))
    .digest("hex");

  try {
    const report = await prisma.errorReport.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        message,
        stack,
        source,
        url,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        stack,
      },
    });

    const status = report.count === 1 ? 201 : 200;

    return NextResponse.json(
      { id: report.id, fingerprint: report.fingerprint, count: report.count },
      { status }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to record error report" },
      { status: 500 }
    );
  }
}
