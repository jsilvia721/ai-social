import { runBrainstormAgent } from "@/lib/brainstorm/run";

export const handler = async () => {
  await runBrainstormAgent();
};
