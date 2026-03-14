import { runResearchPipeline } from "@/lib/research";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () => withCronTracking("research", runResearchPipeline);
