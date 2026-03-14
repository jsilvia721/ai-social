import { runFulfillment } from "@/lib/fulfillment";
import { sendReviewNotifications } from "@/lib/notifications";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () =>
  withCronTracking("fulfill", async () => {
    const result = await runFulfillment();
    console.log("[fulfill cron]", result);

    // Best-effort: notify business owners about new posts awaiting review
    if (result.created > 0) {
      await sendReviewNotifications();
    }

    return { itemsProcessed: result.created };
  });
