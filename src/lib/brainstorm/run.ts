/**
 * Brainstorm orchestrator — main entry point for the brainstorm cron.
 *
 * Ties together generation, iteration, and promotion with:
 * - Wall-clock budget with early termination
 * - Cooldown gating for new brainstorm generation
 * - Error isolation via reportServerError
 */
import { env } from "@/env";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { prisma } from "@/lib/db";
import { reportServerError } from "@/lib/server-error-reporter";
import { generateBrainstorm } from "./generate";
import { iterateBrainstorm } from "./iterate";
import { promoteBrainstormItems } from "./promote";

/** Default wall-clock budget: 4.5 minutes (Lambda timeout is 5m). */
const DEFAULT_BUDGET_MS = 4.5 * 60 * 1000;

/** Safety margin before deadline — ensures enough time to complete the next step. */
const WALL_CLOCK_BUFFER_MS = 30_000;

/** Default cooldown between brainstorm sessions. */
const DEFAULT_FREQUENCY_DAYS = 7;

/**
 * Run the brainstorm agent pipeline.
 *
 * @param deadlineMs - Optional deadline timestamp (ms). Defaults to now + 4.5 minutes.
 */
export async function runBrainstormAgent(deadlineMs?: number): Promise<void> {
  // Guards
  if (!env.GITHUB_TOKEN) return;
  if (shouldMockExternalApis()) return;

  const deadline = deadlineMs ?? Date.now() + DEFAULT_BUDGET_MS;

  // Cleanup: close any sessions with invalid githubIssueNumber (guard against bad data)
  await prisma.brainstormSession.updateMany({
    where: {
      status: "OPEN",
      githubIssueNumber: { lte: 0 },
    },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
    },
  });

  // Find open session (at most one expected)
  const session = await prisma.brainstormSession.findFirst({
    where: { status: "OPEN" },
  });

  if (!session) {
    // No open session — check if we should generate a new one
    if (Date.now() > deadline - WALL_CLOCK_BUFFER_MS) return;

    const frequencyDays = env.BRAINSTORM_FREQUENCY_DAYS ?? DEFAULT_FREQUENCY_DAYS;

    const lastSession = await prisma.brainstormSession.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (lastSession?.closedAt) {
      const cooldownMs = frequencyDays * 24 * 60 * 60 * 1000;
      const elapsed = Date.now() - lastSession.closedAt.getTime();
      if (elapsed < cooldownMs) return;
    }

    // Cooldown passed (or no previous session) — generate
    try {
      await generateBrainstorm();
    } catch (error) {
      await reportServerError(
        `Brainstorm generation failed: ${error instanceof Error ? error.message : String(error)}`,
        { stack: error instanceof Error ? error.stack : undefined },
      );
    }
    return;
  }

  // Open session exists — run iterate then promote
  // Step 1: Iterate (process new comments)
  if (Date.now() < deadline - WALL_CLOCK_BUFFER_MS) {
    try {
      await iterateBrainstorm(session);
    } catch (error) {
      await reportServerError(
        `Brainstorm iteration failed: ${error instanceof Error ? error.message : String(error)}`,
        { stack: error instanceof Error ? error.stack : undefined },
      );
    }
  }

  // Step 2: Promote (checked items → plan issues)
  if (Date.now() < deadline - WALL_CLOCK_BUFFER_MS) {
    try {
      await promoteBrainstormItems(session);
    } catch (error) {
      await reportServerError(
        `Brainstorm promotion failed: ${error instanceof Error ? error.message : String(error)}`,
        { stack: error instanceof Error ? error.stack : undefined },
      );
    }
  }
}
