import { runMetricsRefresh } from "@/lib/scheduler";

export const handler = async () => {
  await runMetricsRefresh();
};
