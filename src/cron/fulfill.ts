import { runFulfillment } from "@/lib/fulfillment";

export const handler = async () => {
  const result = await runFulfillment();
  console.log("[fulfill cron]", result);
};
