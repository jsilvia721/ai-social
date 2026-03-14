import { runScheduler } from "@/lib/scheduler";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () => withCronTracking("publish", runScheduler);
