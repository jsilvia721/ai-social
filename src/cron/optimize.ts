import { runWeeklyOptimization } from "@/lib/optimizer/run";

export const handler = async () => {
  await runWeeklyOptimization();
};
