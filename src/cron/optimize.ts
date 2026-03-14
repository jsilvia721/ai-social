import { runWeeklyOptimization } from "@/lib/optimizer/run";
import { trackCronRun } from "@/lib/system-metrics";

export const handler = async () => {
  const startedAt = new Date();
  try {
    await runWeeklyOptimization();
    await trackCronRun({
      cronName: "optimize",
      status: "SUCCESS",
      itemsProcessed: undefined,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    await trackCronRun({
      cronName: "optimize",
      status: "FAILED",
      durationMs: Date.now() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
};
