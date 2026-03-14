import { runMetricsRefresh } from "@/lib/scheduler";
import { withCronTracking } from "@/lib/system-metrics";
import { prisma } from "@/lib/db";

export const handler = async () => {
  await withCronTracking("metrics", async () => {
    console.log("[metrics-cron] Starting metrics refresh");
    const result = await runMetricsRefresh();
    console.log(`[metrics-cron] Done: ${result.processed} posts processed`);
    return { itemsProcessed: result.processed };
  });

  // Fire-and-forget: 30-day data retention cleanup.
  // Runs after metrics refresh (hourly cadence) to keep tables bounded.
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
