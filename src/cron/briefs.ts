import { runBriefGeneration } from "@/lib/briefs";
import { trackCronRun } from "@/lib/system-metrics";

export const handler = async () => {
  const startedAt = new Date();
  try {
    await runBriefGeneration();
    await trackCronRun({
      cronName: "briefs",
      status: "SUCCESS",
      itemsProcessed: undefined,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    await trackCronRun({
      cronName: "briefs",
      status: "FAILED",
      durationMs: Date.now() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
};
