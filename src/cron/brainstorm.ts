import { runBrainstormAgent } from "@/lib/brainstorm/run";
import { withCronTracking } from "@/lib/system-metrics";

export const handler = () => withCronTracking("brainstorm", runBrainstormAgent);
