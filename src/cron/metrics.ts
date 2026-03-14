import { runMetricsRefresh } from "@/lib/scheduler";

export const handler = async () => {
  console.log("[metrics-cron] Starting metrics refresh");
  const result = await runMetricsRefresh();
  console.log(`[metrics-cron] Done: ${result.processed} posts processed`);
};
