jest.mock("@/lib/optimizer/run", () => ({
  runWeeklyOptimization: jest.fn(),
}));
jest.mock("@/lib/system-metrics", () => ({
  withCronTracking: jest.fn((_name: string, fn: () => Promise<void>) => fn()),
}));

import { handler } from "@/cron/optimize";
import { runWeeklyOptimization } from "@/lib/optimizer/run";

const mockRunWeeklyOptimization = runWeeklyOptimization as jest.Mock;

describe("optimize cron handler", () => {
  it("delegates to runWeeklyOptimization", async () => {
    mockRunWeeklyOptimization.mockResolvedValue({ processed: 2, skipped: 1 });
    await handler();
    expect(mockRunWeeklyOptimization).toHaveBeenCalledTimes(1);
  });
});
