import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/system/shared";
import {
  updateCronSchedule,
  enableCron,
  disableCron,
  buildRateExpression,
} from "@/lib/eventbridge";
import type { CronName } from "@/lib/eventbridge";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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

const VALID_DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;

const RATE_CRONS = new Set([
  "publish",
  "metrics",
  "research",
  "briefs",
  "fulfill",
  "brainstorm",
]);

const WEEKLY_CRONS = new Set(["optimize", "briefs"]);

// Safety rails: min/max interval in minutes per cron
const INTERVAL_LIMITS: Record<string, { min: number; max: number }> = {
  publish: { min: 1, max: 10 },
  metrics: { min: 15, max: 600 },
  research: { min: 60, max: 2880 },
  fulfill: { min: 60, max: 2880 },
  brainstorm: { min: 30, max: 1440 },
  briefs: { min: 60, max: 2880 },
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const patchSchema = z
  .object({
    cronName: z.enum(VALID_CRON_NAMES),
    enabled: z.boolean().optional(),
    intervalValue: z.number().int().positive().optional(),
    intervalUnit: z.enum(["minutes", "hours"]).optional(),
    dayOfWeek: z.enum(VALID_DAYS).optional(),
    hourUtc: z.number().int().min(0).max(23).optional(),
  })
  .superRefine((data, ctx) => {
    const hasScheduleChange =
      data.intervalValue !== undefined ||
      data.intervalUnit !== undefined ||
      data.dayOfWeek !== undefined ||
      data.hourUtc !== undefined;

    if (!hasScheduleChange) return;

    // Rate cron validation
    if (RATE_CRONS.has(data.cronName) && data.intervalValue !== undefined) {
      const unit = data.intervalUnit ?? "minutes";
      const valueInMinutes =
        unit === "hours" ? data.intervalValue * 60 : data.intervalValue;
      const limits = INTERVAL_LIMITS[data.cronName];

      if (limits && (valueInMinutes < limits.min || valueInMinutes > limits.max)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${data.cronName} interval must be between ${limits.min} and ${limits.max} minutes, got ${valueInMinutes}`,
        });
      }
    }

    // Weekly cron validation
    if (WEEKLY_CRONS.has(data.cronName) && data.dayOfWeek !== undefined) {
      if (data.hourUtc === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "hourUtc is required for weekly cron schedule changes",
        });
      }
    }
  });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCronExpression(dayOfWeek: string, hourUtc: number): string {
  return `cron(0 ${hourUtc} ? * ${dayOfWeek} *)`;
}

// ---------------------------------------------------------------------------
// GET — return all cron configs enriched with last run info
// ---------------------------------------------------------------------------

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  try {
    const [configs, latestRuns] = await Promise.all([
      prisma.cronConfig.findMany({
        orderBy: { cronName: "asc" },
      }),
      // Get the latest run per cron name
      prisma.cronRun.findMany({
        orderBy: { startedAt: "desc" },
        distinct: ["cronName"],
        select: {
          cronName: true,
          status: true,
          startedAt: true,
        },
      }),
    ]);

    // Index latest runs by cron name
    const latestRunMap = new Map(
      latestRuns.map((r) => [r.cronName, r])
    );

    const enriched = configs.map((config) => {
      const latestRun = latestRunMap.get(config.cronName);
      return {
        id: config.id,
        cronName: config.cronName,
        scheduleExpression: config.scheduleExpression,
        scheduleType: config.scheduleType,
        enabled: config.enabled,
        intervalValue: config.intervalValue,
        intervalUnit: config.intervalUnit,
        dayOfWeek: config.dayOfWeek,
        hourUtc: config.hourUtc,
        syncStatus: config.syncStatus,
        updatedAt: config.updatedAt.toISOString(),
        lastRunAt: latestRun?.startedAt.toISOString() ?? null,
        lastStatus: latestRun?.status ?? null,
      };
    });

    return NextResponse.json({ configs: enriched });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — update cron config + sync to EventBridge
// ---------------------------------------------------------------------------

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const { cronName, enabled, intervalValue, intervalUnit, dayOfWeek, hourUtc } =
    parsed.data;

  try {
    // Determine what to update
    const hasScheduleChange =
      intervalValue !== undefined ||
      dayOfWeek !== undefined ||
      hourUtc !== undefined;

    let warning: string | undefined;

    // Handle enable/disable toggle
    if (enabled !== undefined && !hasScheduleChange) {
      await prisma.cronConfig.update({
        where: { cronName },
        data: { enabled },
      });

      const ebResult = enabled
        ? await enableCron(cronName as CronName)
        : await disableCron(cronName as CronName);

      if (!ebResult.success) {
        await prisma.cronConfig.update({
          where: { cronName },
          data: { syncStatus: "PENDING" },
        });
        warning = "EventBridge sync pending";
      }

      return NextResponse.json({
        success: true,
        ...(warning ? { warning } : {}),
      });
    }

    // Handle schedule change for rate-based crons
    if (hasScheduleChange && intervalValue !== undefined) {
      const unit = intervalUnit ?? "minutes";
      const ebUnit = unit === "minutes" ? "minute" : "hour";
      const expression = buildRateExpression(intervalValue, ebUnit);

      // Update DB first
      await prisma.cronConfig.update({
        where: { cronName },
        data: {
          intervalValue,
          intervalUnit: unit,
          scheduleExpression: expression,
          syncStatus: "SYNCED",
          ...(enabled !== undefined ? { enabled } : {}),
        },
      });

      // Sync to EventBridge
      const ebResult = await updateCronSchedule(
        cronName as CronName,
        expression
      );

      if (!ebResult.success) {
        await prisma.cronConfig.update({
          where: { cronName },
          data: { syncStatus: "PENDING" },
        });
        warning = "EventBridge sync pending";
      }

      return NextResponse.json({
        success: true,
        ...(warning ? { warning } : {}),
      });
    }

    // Handle schedule change for weekly crons
    if (hasScheduleChange && dayOfWeek !== undefined && hourUtc !== undefined) {
      const expression = buildCronExpression(dayOfWeek, hourUtc);

      await prisma.cronConfig.update({
        where: { cronName },
        data: {
          dayOfWeek,
          hourUtc,
          scheduleExpression: expression,
          syncStatus: "SYNCED",
          ...(enabled !== undefined ? { enabled } : {}),
        },
      });

      const ebResult = await updateCronSchedule(
        cronName as CronName,
        expression
      );

      if (!ebResult.success) {
        await prisma.cronConfig.update({
          where: { cronName },
          data: { syncStatus: "PENDING" },
        });
        warning = "EventBridge sync pending";
      }

      return NextResponse.json({
        success: true,
        ...(warning ? { warning } : {}),
      });
    }

    // If only cronName provided, nothing to update
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
