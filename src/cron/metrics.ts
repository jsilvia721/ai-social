import { runMetricsRefresh } from "@/lib/scheduler";
import { trackCronRun } from "@/lib/system-metrics";
import { prisma } from "@/lib/db";

export const handler = async () => {
  const startedAt = new Date();
  try {
    console.log("[metrics-cron] Starting metrics refresh");
    const result = await runMetricsRefresh();
    console.log(`[metrics-cron] Done: ${result.processed} posts processed`);

    await trackCronRun({
      cronName: "metrics",
      status: "SUCCESS",
      itemsProcessed: result.processed,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    await trackCronRun({
      cronName: "metrics",
      status: "FAILED",
      durationMs: Date.now() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }

  // Fire-and-forget: 30-day data retention cleanup
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.apiCall.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });
    await prisma.cronRun.deleteMany({
      where: { startedAt: { lt: thirtyDaysAgo } },
    });
  } catch {
    /* never throw */
  }
};
