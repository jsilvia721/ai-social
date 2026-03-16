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
