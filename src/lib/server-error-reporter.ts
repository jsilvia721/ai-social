/**
 * Server-side error reporter — logs errors to the ErrorReport table.
 *
 * Uses the same fingerprinting and upsert pattern as /api/errors/route.ts
 * but callable from server-side code (crons, background jobs) without
 * going through HTTP.
 *
 * IMPORTANT: This function must NEVER throw. Error reporting should not
 * crash the caller.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { normalizeMessage } from "@/lib/normalize-error";
import type { Prisma } from "@prisma/client";

interface ReportOptions {
  stack?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export async function reportServerError(
  message: string,
  options?: ReportOptions
): Promise<void> {
  try {
    const fingerprint = crypto
      .createHash("sha256")
      .update("SERVER:" + normalizeMessage(message))
      .digest("hex");

    await prisma.errorReport.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        message,
        stack: options?.stack,
        source: "SERVER",
        url: options?.url,
        metadata: options?.metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        stack: options?.stack,
      },
    });
  } catch {
    // Swallow — error reporting must never crash the caller
  }
}
