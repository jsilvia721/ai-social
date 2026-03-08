import { runResearchPipeline } from "@/lib/research";

export const handler = async () => {
  await runResearchPipeline();
};
