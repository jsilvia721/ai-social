/**
 * Fire-and-forget helper for writing structured agent audit events.
 *
 * Follows the same pattern as trackApiCall() in system-metrics.ts —
 * must NEVER throw, NEVER block the caller, and NEVER interfere
 * with the real operation.
 */
import { prisma } from "@/lib/db";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import type { Prisma } from "@prisma/client";

/**
 * Write a structured agent audit event to the database.
 *
 * @param data.eventType - Dotted identifier, e.g. "brief.generated", "post.approved"
 * @param data.actor - Prefixed identifier, e.g. "cron:research", "user:<userId>"
 * @param data.payload - Structured event-specific data. **NEVER include sensitive
 *   values** (accessToken, refreshToken, passwords, API keys, PII). This data is
 *   stored unencrypted and may be surfaced in dashboards.
 */
export async function emitAgentEvent(data: {
  eventType: string;
  actor: string;
  businessId?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    if (shouldMockExternalApis()) return;

    await prisma.agentEvent.create({
      data: {
        eventType: data.eventType,
        actor: data.actor,
        businessId: data.businessId,
        entityType: data.entityType,
        entityId: data.entityId,
        payload: data.payload as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    // Swallow — agent event tracking must never crash the caller
  }
}
