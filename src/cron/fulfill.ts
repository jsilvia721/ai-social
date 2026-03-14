import { runFulfillment } from "@/lib/fulfillment";
import { sendReviewNotifications } from "@/lib/notifications";
import { trackCronRun } from "@/lib/system-metrics";

export const handler = async () => {
  const startedAt = new Date();
  try {
    const result = await runFulfillment();
    console.log("[fulfill cron]", result);

    // Best-effort: notify business owners about new posts awaiting review
    if (result.created > 0) {
      await sendReviewNotifications();
    }

    await trackCronRun({
      cronName: "fulfill",
      status: "SUCCESS",
      itemsProcessed: result.created,
      durationMs: Date.now() - startedAt.getTime(),
      startedAt,
      completedAt: new Date(),
    });
  } catch (err) {
    await trackCronRun({
      cronName: "fulfill",
      status: "FAILED",
      durationMs: Date.now() - startedAt.getTime(),
      error: err instanceof Error ? err.message : String(err),
      startedAt,
      completedAt: new Date(),
    });
    throw err;
  }
};
