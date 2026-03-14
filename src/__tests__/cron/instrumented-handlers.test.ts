import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

// Must mock before imports
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/scheduler", () => ({
  runScheduler: jest.fn(),
  runMetricsRefresh: jest.fn(),
}));
jest.mock("@/lib/research", () => ({ runResearchPipeline: jest.fn() }));
jest.mock("@/lib/briefs", () => ({ runBriefGeneration: jest.fn() }));
jest.mock("@/lib/fulfillment", () => ({ runFulfillment: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  sendReviewNotifications: jest.fn(),
}));
jest.mock("@/lib/optimizer/run", () => ({ runWeeklyOptimization: jest.fn() }));
jest.mock("@/lib/brainstorm/run", () => ({ runBrainstormAgent: jest.fn() }));
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));

import { handler as publishHandler } from "@/cron/publish";
import { handler as metricsHandler } from "@/cron/metrics";
import { handler as researchHandler } from "@/cron/research";
import { handler as briefsHandler } from "@/cron/briefs";
import { handler as fulfillHandler } from "@/cron/fulfill";
import { handler as optimizeHandler } from "@/cron/optimize";
import { handler as brainstormHandler } from "@/cron/brainstorm";

import { runScheduler, runMetricsRefresh } from "@/lib/scheduler";
import { runResearchPipeline } from "@/lib/research";
import { runBriefGeneration } from "@/lib/briefs";
import { runFulfillment } from "@/lib/fulfillment";
import { sendReviewNotifications } from "@/lib/notifications";
import { runWeeklyOptimization } from "@/lib/optimizer/run";
import { runBrainstormAgent } from "@/lib/brainstorm/run";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  prismaMock.cronRun.create.mockResolvedValue({ id: "cr-1" } as never);
});

describe("withCronTracking (via publish handler)", () => {
  it("records SUCCESS with durationMs, startedAt, completedAt", async () => {
    (runScheduler as jest.Mock).mockResolvedValue(undefined);
    await publishHandler();

    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: undefined,
      }),
    });
    const data = prismaMock.cronRun.create.mock.calls[0][0].data;
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it("records FAILED with error message and re-throws", async () => {
    (runScheduler as jest.Mock).mockRejectedValue(new Error("publish boom"));

    await expect(publishHandler()).rejects.toThrow("publish boom");

    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cronName: "publish",
        status: "FAILED",
        error: "publish boom",
      }),
    });
  });

  it("stringifies non-Error thrown values", async () => {
    (runScheduler as jest.Mock).mockRejectedValue("string error");

    await expect(publishHandler()).rejects.toBe("string error");

    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        error: "string error",
      }),
    });
  });
});

describe("all handlers wire correct cronName", () => {
  const cases: [string, () => Promise<void>, jest.Mock][] = [
    ["publish", publishHandler, runScheduler as jest.Mock],
    ["research", researchHandler, runResearchPipeline as jest.Mock],
    ["briefs", briefsHandler, runBriefGeneration as jest.Mock],
    ["optimize", optimizeHandler, runWeeklyOptimization as jest.Mock],
    ["brainstorm", brainstormHandler, runBrainstormAgent as jest.Mock],
  ];

  it.each(cases)("%s handler tracks with correct name", async (name, handler, mock) => {
    mock.mockResolvedValue(undefined);
    await handler();
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cronName: name, status: "SUCCESS" }),
    });
  });

  it.each(cases)("%s handler tracks FAILED on error", async (name, handler, mock) => {
    mock.mockRejectedValue(new Error("boom"));
    await expect(handler()).rejects.toThrow("boom");
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cronName: name, status: "FAILED" }),
    });
  });
});

describe("metrics handler", () => {
  it("passes itemsProcessed from result.processed", async () => {
    (runMetricsRefresh as jest.Mock).mockResolvedValue({ processed: 10 });
    await metricsHandler();
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cronName: "metrics",
        status: "SUCCESS",
        itemsProcessed: 10,
      }),
    });
  });

  it("runs 30-day data retention cleanup", async () => {
    (runMetricsRefresh as jest.Mock).mockResolvedValue({ processed: 0 });
    prismaMock.apiCall.deleteMany.mockResolvedValue({ count: 5 } as never);
    prismaMock.cronRun.deleteMany.mockResolvedValue({ count: 3 } as never);

    await metricsHandler();

    expect(prismaMock.apiCall.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
    expect(prismaMock.cronRun.deleteMany).toHaveBeenCalledWith({
      where: { startedAt: { lt: expect.any(Date) } },
    });
  });

  it("cleanup failure does not throw", async () => {
    (runMetricsRefresh as jest.Mock).mockResolvedValue({ processed: 0 });
    prismaMock.apiCall.deleteMany.mockRejectedValue(new Error("db error"));

    await expect(metricsHandler()).resolves.toBeUndefined();
  });

  it("tracks FAILED and re-throws on error", async () => {
    (runMetricsRefresh as jest.Mock).mockRejectedValue(
      new Error("metrics boom")
    );
    await expect(metricsHandler()).rejects.toThrow("metrics boom");
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cronName: "metrics",
        status: "FAILED",
        error: "metrics boom",
      }),
    });
  });
});

describe("fulfill handler", () => {
  it("passes itemsProcessed from result.created", async () => {
    (runFulfillment as jest.Mock).mockResolvedValue({ created: 3 });
    (sendReviewNotifications as jest.Mock).mockResolvedValue(undefined);

    await fulfillHandler();

    expect(sendReviewNotifications).toHaveBeenCalled();
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cronName: "fulfill",
        status: "SUCCESS",
        itemsProcessed: 3,
      }),
    });
  });

  it("skips notifications when created is 0", async () => {
    (runFulfillment as jest.Mock).mockResolvedValue({ created: 0 });

    await fulfillHandler();

    expect(sendReviewNotifications).not.toHaveBeenCalled();
  });

  it("tracks FAILED and re-throws on error", async () => {
    (runFulfillment as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(fulfillHandler()).rejects.toThrow("boom");
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cronName: "fulfill", status: "FAILED" }),
    });
  });
});
