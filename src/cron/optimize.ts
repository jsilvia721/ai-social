import { runWeeklyOptimization } from "@/lib/optimizer/run";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () =>
  withCronTracking("optimize", runWeeklyOptimization);
