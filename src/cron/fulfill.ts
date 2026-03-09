import { runFulfillment } from "@/lib/fulfillment";
import { sendReviewNotifications } from "@/lib/notifications";

export const handler = async () => {
  const result = await runFulfillment();
  console.log("[fulfill cron]", result);

  // Best-effort: notify business owners about new posts awaiting review
  if (result.created > 0) {
    await sendReviewNotifications();
  }
};
