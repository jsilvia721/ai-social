import { runScheduler } from "@/lib/scheduler";

export const handler = async () => {
  await runScheduler();
};
