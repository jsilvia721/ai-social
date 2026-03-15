/**
 * Fire-and-forget helpers for tracking API calls and cron runs.
 *
 * These functions write to the ApiCall and CronRun tables for
 * system observability. They follow the same pattern as
 * reportServerError() — they must NEVER throw, NEVER block the
 * caller, and NEVER interfere with the real operation.
 */
import { prisma } from "@/lib/db";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import type { Prisma } from "@prisma/client";

export async function trackApiCall(data: {
  service: string;
  endpoint: string;
  method?: string;
  statusCode?: number;
  latencyMs: number;
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    if (shouldMockExternalApis()) return;

    await prisma.apiCall.create({
      data: {
        service: data.service,
        endpoint: data.endpoint,
        method: data.method ?? "POST",
        statusCode: data.statusCode,
        latencyMs: data.latencyMs,
        error: data.error,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Swallow — metrics tracking must never crash the caller
  }
}

export type CronName =
  | "publish"
  | "metrics"
  | "research"
  | "briefs"
  | "fulfill"
  | "optimize"
  | "brainstorm";

// Always write CronRun regardless of mock mode — cron logic still
// runs in staging/dev and we want visibility into those executions.
export async function trackCronRun(data: {
  cronName: CronName;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  itemsProcessed?: number;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
  startedAt: Date;
  completedAt?: Date;
}): Promise<void> {
  try {
    await prisma.cronRun.create({
      data: {
        cronName: data.cronName,
        status: data.status,
        itemsProcessed: data.itemsProcessed,
        durationMs: data.durationMs,
        error: data.error,
        metadata: data.metadata as Prisma.InputJsonValue | undefined,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
      },
    });
  } catch {
    // Swallow — metrics tracking must never crash the caller
  }
}

/**
 * Checks whether a cron job is enabled via the CronConfig table.
 * Fails open (returns enabled: true) on any DB error or missing config,
 * so crons keep running even if the config table is unavailable.
 */
export async function checkCronEnabled(
  cronName: CronName
): Promise<{ enabled: boolean }> {
  try {
    const config = await prisma.cronConfig.findUnique({
      where: { cronName },
      select: { enabled: true },
    });
    // Fail open if config row doesn't exist
    return { enabled: config?.enabled ?? true };
  } catch {
    // Fail open on DB error
    return { enabled: true };
  }
}

/**
 * Wraps a cron handler with CronRun tracking. Checks CronConfig first;
 * if disabled, records a SKIPPED run and returns early. Otherwise records
 * SUCCESS with duration and optional itemsProcessed on success, or FAILED
 * with the error message on failure (then re-throws so Lambda marks it failed).
 */
export async function withCronTracking(
  cronName: CronName,
  fn: () => Promise<Record<string, unknown> | void>
): Promise<void> {
  const { enabled } = await checkCronEnabled(cronName);
  if (!enabled) {
    const now = new Date();
    await trackCronRun({
      cronName,
      status: "SKIPPED",
      durationMs: 0,
      startedAt: now,
      completedAt: now,
    });
    return;
  }

  const startedAt = new Date();
  try {
    const result = await fn();
    await trackCronRun({
      cronName,
      status: "SUCCESS",
      itemsProcessed:
        result &&
        typeof result === "object" &&
        "itemsProcessed" in result &&
        typeof result.itemsProcessed === "number"
          ? result.itemsProcessed
          : undefined,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    await trackCronRun({
      cronName,
      status: "FAILED",
      durationMs: Date.now() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
}
