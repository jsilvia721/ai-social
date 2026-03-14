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
jest.mock("@/lib/notifications", () => ({ sendReviewNotifications: jest.fn() }));
jest.mock("@/lib/optimizer/run", () => ({ runWeeklyOptimization: jest.fn() }));
jest.mock("@/lib/brainstorm/run", () => ({ runBrainstormAgent: jest.fn() }));
jest.mock("@/lib/system-metrics", () => ({
  trackCronRun: jest.fn().mockResolvedValue(undefined),
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
import { trackCronRun } from "@/lib/system-metrics";

const mockTrackCronRun = trackCronRun as jest.MockedFunction<
  typeof trackCronRun
>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("publish cron handler", () => {
  it("tracks SUCCESS on successful run", async () => {
    (runScheduler as jest.Mock).mockResolvedValue(undefined);

    await publishHandler();

    expect(runScheduler).toHaveBeenCalledTimes(1);
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: undefined,
      })
    );
    expect(mockTrackCronRun.mock.calls[0][0]).toHaveProperty("durationMs");
    expect(mockTrackCronRun.mock.calls[0][0]).toHaveProperty("startedAt");
    expect(mockTrackCronRun.mock.calls[0][0]).toHaveProperty("completedAt");
  });

  it("tracks FAILED and re-throws on error", async () => {
    (runScheduler as jest.Mock).mockRejectedValue(new Error("publish boom"));

    await expect(publishHandler()).rejects.toThrow("publish boom");

    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "publish",
        status: "FAILED",
        error: "publish boom",
      })
    );
  });
});

describe("metrics cron handler", () => {
  it("tracks SUCCESS with itemsProcessed", async () => {
    (runMetricsRefresh as jest.Mock).mockResolvedValue({ processed: 10 });

    await metricsHandler();

    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "metrics",
        status: "SUCCESS",
        itemsProcessed: 10,
      })
    );
  });

  it("runs 30-day data retention cleanup", async () => {
    (runMetricsRefresh as jest.Mock).mockResolvedValue({ processed: 0 });
    prismaMock.apiCall.deleteMany.mockResolvedValue({ count: 5 });
    prismaMock.cronRun.deleteMany.mockResolvedValue({ count: 3 });

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

    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "metrics",
        status: "FAILED",
        error: "metrics boom",
      })
    );
  });
});

describe("research cron handler", () => {
  it("tracks SUCCESS", async () => {
    (runResearchPipeline as jest.Mock).mockResolvedValue(undefined);
    await researchHandler();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "research", status: "SUCCESS" })
    );
  });

  it("tracks FAILED and re-throws", async () => {
    (runResearchPipeline as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(researchHandler()).rejects.toThrow("boom");
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "research", status: "FAILED" })
    );
  });
});

describe("briefs cron handler", () => {
  it("tracks SUCCESS", async () => {
    (runBriefGeneration as jest.Mock).mockResolvedValue(undefined);
    await briefsHandler();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "briefs", status: "SUCCESS" })
    );
  });

  it("tracks FAILED and re-throws", async () => {
    (runBriefGeneration as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(briefsHandler()).rejects.toThrow("boom");
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "briefs", status: "FAILED" })
    );
  });
});

describe("fulfill cron handler", () => {
  it("tracks SUCCESS with itemsProcessed from result.created", async () => {
    (runFulfillment as jest.Mock).mockResolvedValue({ created: 3 });
    (sendReviewNotifications as jest.Mock).mockResolvedValue(undefined);

    await fulfillHandler();

    expect(sendReviewNotifications).toHaveBeenCalled();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "fulfill",
        status: "SUCCESS",
        itemsProcessed: 3,
      })
    );
  });

  it("skips notifications when created is 0", async () => {
    (runFulfillment as jest.Mock).mockResolvedValue({ created: 0 });

    await fulfillHandler();

    expect(sendReviewNotifications).not.toHaveBeenCalled();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({
        cronName: "fulfill",
        status: "SUCCESS",
        itemsProcessed: 0,
      })
    );
  });

  it("tracks FAILED and re-throws", async () => {
    (runFulfillment as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(fulfillHandler()).rejects.toThrow("boom");
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "fulfill", status: "FAILED" })
    );
  });
});

describe("optimize cron handler", () => {
  it("tracks SUCCESS", async () => {
    (runWeeklyOptimization as jest.Mock).mockResolvedValue(undefined);
    await optimizeHandler();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "optimize", status: "SUCCESS" })
    );
  });

  it("tracks FAILED and re-throws", async () => {
    (runWeeklyOptimization as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(optimizeHandler()).rejects.toThrow("boom");
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "optimize", status: "FAILED" })
    );
  });
});

describe("brainstorm cron handler", () => {
  it("tracks SUCCESS", async () => {
    (runBrainstormAgent as jest.Mock).mockResolvedValue(undefined);
    await brainstormHandler();
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "brainstorm", status: "SUCCESS" })
    );
  });

  it("tracks FAILED and re-throws", async () => {
    (runBrainstormAgent as jest.Mock).mockRejectedValue(new Error("boom"));
    await expect(brainstormHandler()).rejects.toThrow("boom");
    expect(mockTrackCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ cronName: "brainstorm", status: "FAILED" })
    );
  });
});
