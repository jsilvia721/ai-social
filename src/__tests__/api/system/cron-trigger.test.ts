import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

// Mock all 7 handler modules
const mockRunScheduler = jest.fn().mockResolvedValue({ processed: 1 });
const mockRunMetricsRefresh = jest.fn().mockResolvedValue({ processed: 1 });
const mockRunResearchPipeline = jest.fn().mockResolvedValue(undefined);
const mockRunBriefGeneration = jest.fn().mockResolvedValue(undefined);
const mockRunFulfillment = jest.fn().mockResolvedValue(undefined);
const mockRunWeeklyOptimization = jest.fn().mockResolvedValue(undefined);
const mockRunBrainstormAgent = jest.fn().mockResolvedValue(undefined);

jest.mock("@/lib/scheduler", () => ({
  runScheduler: (...args: unknown[]) => mockRunScheduler(...args),
  runMetricsRefresh: (...args: unknown[]) => mockRunMetricsRefresh(...args),
}));
jest.mock("@/lib/research", () => ({
  runResearchPipeline: (...args: unknown[]) => mockRunResearchPipeline(...args),
}));
jest.mock("@/lib/briefs", () => ({
  runBriefGeneration: (...args: unknown[]) => mockRunBriefGeneration(...args),
}));
jest.mock("@/lib/fulfillment", () => ({
  runFulfillment: (...args: unknown[]) => mockRunFulfillment(...args),
}));
jest.mock("@/lib/optimizer/run", () => ({
  runWeeklyOptimization: (...args: unknown[]) =>
    mockRunWeeklyOptimization(...args),
}));
jest.mock("@/lib/brainstorm/run", () => ({
  runBrainstormAgent: (...args: unknown[]) => mockRunBrainstormAgent(...args),
}));

import { POST } from "@/app/api/system/cron/trigger/route";
import { NextRequest } from "next/server";

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/system/cron/trigger", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

// ─── Auth ─────────────────────────────────────────────────────────────────

describe("POST /api/system/cron/trigger", () => {
  it("returns 401 without session", async () => {
    mockUnauthenticated();
    const res = await POST(makePostRequest({ cronName: "publish" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuthenticated();
    const res = await POST(makePostRequest({ cronName: "publish" }));
    expect(res.status).toBe(403);
  });

  // ─── Validation ───────────────────────────────────────────────────────

  it("returns 400 for invalid cronName", async () => {
    mockAuthenticatedAsAdmin();
    const res = await POST(makePostRequest({ cronName: "invalid" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing cronName", async () => {
    mockAuthenticatedAsAdmin();
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  // ─── Happy path — all 7 crons ─────────────────────────────────────────

  const cronNames = [
    "publish",
    "metrics",
    "research",
    "briefs",
    "fulfill",
    "optimize",
    "brainstorm",
  ] as const;

  it.each(cronNames)(
    "returns 200 and creates CronRun for %s",
    async (cronName) => {
      mockAuthenticatedAsAdmin();
      (prismaMock.cronRun.findFirst as jest.Mock).mockResolvedValue(null);

      const mockCronRun = {
        id: `cr-${cronName}`,
        cronName,
        status: "RUNNING",
        startedAt: new Date(),
        metadata: { triggerSource: "manual" },
      };
      (prismaMock.cronRun.create as jest.Mock).mockResolvedValue(mockCronRun);

      const res = await POST(makePostRequest({ cronName }));
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.cronName).toBe(cronName);

      // Verify CronRun created with RUNNING status and manual trigger source
      expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          cronName,
          status: "RUNNING",
          metadata: { triggerSource: "manual" },
        }),
      });
    }
  );

  // ─── CronRun creation ─────────────────────────────────────────────────

  it("creates CronRun with RUNNING status and triggerSource metadata", async () => {
    mockAuthenticatedAsAdmin();

    const mockCronRun = {
      id: "cr-test",
      cronName: "metrics",
      status: "RUNNING",
      startedAt: new Date(),
      metadata: { triggerSource: "manual" },
    };
    (prismaMock.cronRun.create as jest.Mock).mockResolvedValue(mockCronRun);

    await POST(makePostRequest({ cronName: "metrics" }));

    expect(prismaMock.cronRun.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: {
        cronName: "metrics",
        status: "RUNNING",
        startedAt: expect.any(Date),
        metadata: { triggerSource: "manual" },
      },
    });
  });

  // ─── Concurrency guard ─────────────────────────────────────────────────

  it("returns 409 when cron is already running", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronRun.findFirst as jest.Mock).mockResolvedValue({
      id: "cr-existing",
    });

    const res = await POST(makePostRequest({ cronName: "publish" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already running");
  });

  // ─── Async handler execution ──────────────────────────────────────────

  it("fires handler asynchronously and updates CronRun on success", async () => {
    mockAuthenticatedAsAdmin();

    const mockCronRun = {
      id: "cr-async-test",
      cronName: "publish",
      status: "RUNNING",
      startedAt: new Date(),
      metadata: { triggerSource: "manual" },
    };
    (prismaMock.cronRun.create as jest.Mock).mockResolvedValue(mockCronRun);

    await POST(makePostRequest({ cronName: "publish" }));

    // Wait for the async handler to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockRunScheduler).toHaveBeenCalled();
    expect(prismaMock.cronRun.update).toHaveBeenCalledWith({
      where: { id: "cr-async-test" },
      data: {
        status: "SUCCESS",
        durationMs: expect.any(Number),
      },
    });
  });

  it("updates CronRun to FAILED when handler throws", async () => {
    mockAuthenticatedAsAdmin();

    const mockCronRun = {
      id: "cr-fail-test",
      cronName: "research",
      status: "RUNNING",
      startedAt: new Date(),
      metadata: { triggerSource: "manual" },
    };
    (prismaMock.cronRun.create as jest.Mock).mockResolvedValue(mockCronRun);
    (prismaMock.cronRun.update as jest.Mock).mockResolvedValue({});
    mockRunResearchPipeline.mockRejectedValueOnce(new Error("Handler failed"));

    await POST(makePostRequest({ cronName: "research" }));

    // Wait for the async handler to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(prismaMock.cronRun.update).toHaveBeenCalledWith({
      where: { id: "cr-fail-test" },
      data: {
        status: "FAILED",
        durationMs: expect.any(Number),
        error: "Handler failed",
      },
    });
  });

  // ─── Error handling ───────────────────────────────────────────────────

  it("returns 500 when CronRun creation fails", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronRun.create as jest.Mock).mockRejectedValue(
      new Error("DB error")
    );

    const res = await POST(makePostRequest({ cronName: "publish" }));
    expect(res.status).toBe(500);
  });
});
