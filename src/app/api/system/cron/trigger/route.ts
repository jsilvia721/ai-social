import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/system/shared";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { runScheduler, runMetricsRefresh } from "@/lib/scheduler";
import { runResearchPipeline } from "@/lib/research";
import { runBriefGeneration } from "@/lib/briefs";
import { runFulfillment } from "@/lib/fulfillment";
import { runWeeklyOptimization } from "@/lib/optimizer/run";
import { runBrainstormAgent } from "@/lib/brainstorm/run";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CRON_NAMES = [
  "publish",
  "metrics",
  "research",
  "briefs",
  "fulfill",
  "optimize",
  "brainstorm",
] as const;

type CronName = (typeof VALID_CRON_NAMES)[number];

const triggerSchema = z.object({
  cronName: z.enum(VALID_CRON_NAMES),
});

// ---------------------------------------------------------------------------
// Handler lookup map
// ---------------------------------------------------------------------------

const HANDLER_MAP: Record<CronName, () => Promise<unknown>> = {
  publish: runScheduler,
  metrics: runMetricsRefresh,
  research: runResearchPipeline,
  briefs: runBriefGeneration,
  fulfill: runFulfillment,
  optimize: runWeeklyOptimization,
  brainstorm: runBrainstormAgent,
};

// ---------------------------------------------------------------------------
// POST — manually trigger a cron job
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const { cronName } = parsed.data;

  try {
    // Create a RUNNING CronRun entry with manual trigger metadata
    const cronRun = await prisma.cronRun.create({
      data: {
        cronName,
        status: "RUNNING",
        startedAt: new Date(),
        metadata: { triggerSource: "manual" },
      },
    });

    // Fire-and-forget: run the handler asynchronously
    const startTime = Date.now();
    const handler = HANDLER_MAP[cronName];

    void (async () => {
      try {
        await handler();
        await prisma.cronRun.update({
          where: { id: cronRun.id },
          data: {
            status: "SUCCESS",
            durationMs: Date.now() - startTime,
          },
        });
      } catch (err) {
        console.error(`[cron/trigger] ${cronName} handler failed:`, err);
        await prisma.cronRun.update({
          where: { id: cronRun.id },
          data: {
            status: "FAILED",
            durationMs: Date.now() - startTime,
            error: err instanceof Error ? err.message : String(err),
          },
        }).catch((updateErr) => {
          console.error(`[cron/trigger] Failed to update CronRun:`, updateErr);
        });
      }
    })();

    return NextResponse.json({ success: true, cronName });
  } catch (err) {
    console.error("[POST /api/system/cron/trigger]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
