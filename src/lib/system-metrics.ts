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

// Always write CronRun regardless of mock mode — cron logic still
// runs in staging/dev and we want visibility into those executions.
export async function trackCronRun(data: {
  cronName: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
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
