import { runBriefGeneration } from "@/lib/briefs";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () => withCronTracking("briefs", runBriefGeneration);
