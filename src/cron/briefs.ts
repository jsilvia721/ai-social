import { runBriefGeneration } from "@/lib/briefs";

export const handler = async () => {
  await runBriefGeneration();
};
