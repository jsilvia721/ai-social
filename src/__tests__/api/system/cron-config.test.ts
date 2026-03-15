import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

const mockUpdateCronSchedule = jest.fn();
const mockEnableCron = jest.fn();
const mockDisableCron = jest.fn();
jest.mock("@/lib/eventbridge", () => ({
  updateCronSchedule: (...args: unknown[]) => mockUpdateCronSchedule(...args),
  enableCron: (...args: unknown[]) => mockEnableCron(...args),
  disableCron: (...args: unknown[]) => mockDisableCron(...args),
  buildRateExpression: jest.requireActual("@/lib/eventbridge").buildRateExpression,
}));

import { GET, PATCH } from "@/app/api/system/cron-config/route";
import { NextRequest } from "next/server";

function makePatchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/system/cron-config", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const now = new Date();

const mockConfigs = [
  {
    id: "cc-1",
    cronName: "publish",
    scheduleExpression: "rate(1 minute)",
    scheduleType: "rate",
    enabled: true,
    intervalValue: 1,
    intervalUnit: "minutes",
    dayOfWeek: null,
    hourUtc: null,
    syncStatus: "SYNCED",
    updatedAt: now,
  },
  {
    id: "cc-2",
    cronName: "metrics",
    scheduleExpression: "rate(60 minutes)",
    scheduleType: "rate",
    enabled: true,
    intervalValue: 60,
    intervalUnit: "minutes",
    dayOfWeek: null,
    hourUtc: null,
    syncStatus: "SYNCED",
    updatedAt: now,
  },
  {
    id: "cc-3",
    cronName: "optimize",
    scheduleExpression: "cron(0 23 ? * SUN *)",
    scheduleType: "cron",
    enabled: true,
    intervalValue: null,
    intervalUnit: null,
    dayOfWeek: "SUN",
    hourUtc: 23,
    syncStatus: "SYNCED",
    updatedAt: now,
  },
];

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

// ─── GET /api/system/cron-config ────────────────────────────────────────

describe("GET /api/system/cron-config", () => {
  it("returns 401 without session", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuthenticated();
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("returns all configs with lastRunAt and lastStatus for admin", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.findMany as jest.Mock).mockResolvedValue(mockConfigs);
    (prismaMock.cronRun.findMany as jest.Mock).mockResolvedValue([
      {
        cronName: "publish",
        status: "SUCCESS",
        startedAt: new Date("2026-03-15T10:00:00Z"),
      },
      {
        cronName: "metrics",
        status: "FAILED",
        startedAt: new Date("2026-03-15T09:00:00Z"),
      },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.configs).toHaveLength(3);

    const publish = body.configs.find(
      (c: Record<string, unknown>) => c.cronName === "publish"
    );
    expect(publish).toBeDefined();
    expect(publish.lastRunAt).toBe("2026-03-15T10:00:00.000Z");
    expect(publish.lastStatus).toBe("SUCCESS");
    expect(publish.syncStatus).toBe("SYNCED");

    const optimize = body.configs.find(
      (c: Record<string, unknown>) => c.cronName === "optimize"
    );
    expect(optimize.lastRunAt).toBeNull();
    expect(optimize.lastStatus).toBeNull();
  });

  it("returns empty array when no configs exist", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.findMany as jest.Mock).mockResolvedValue([]);
    (prismaMock.cronRun.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configs).toEqual([]);
  });

  it("returns 500 when database fails", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.findMany as jest.Mock).mockRejectedValue(
      new Error("DB error")
    );
    const res = await GET();
    expect(res.status).toBe(500);
  });
});

// ─── PATCH /api/system/cron-config ──────────────────────────────────────

describe("PATCH /api/system/cron-config", () => {
  it("returns 401 without session", async () => {
    mockUnauthenticated();
    const res = await PATCH(makePatchRequest({ cronName: "publish" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuthenticated();
    const res = await PATCH(makePatchRequest({ cronName: "publish" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid cronName", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(makePatchRequest({ cronName: "invalid" }));
    expect(res.status).toBe(400);
  });

  // ─── Safety rail validation ───────────────────────────────────────

  it("rejects publish interval below 1 minute", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "publish",
        intervalValue: 0,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("publish");
  });

  it("rejects publish interval above 10 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "publish",
        intervalValue: 11,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects metrics interval below 15 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "metrics",
        intervalValue: 10,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects metrics interval above 600 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "metrics",
        intervalValue: 601,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects research interval below 60 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "research",
        intervalValue: 30,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects fulfill interval above 2880 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "fulfill",
        intervalValue: 3000,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects brainstorm interval below 30 minutes", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "brainstorm",
        intervalValue: 20,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid hourUtc for weekly crons", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "optimize",
        dayOfWeek: "MON",
        hourUtc: 25,
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects rate params for weekly-only cron (optimize)", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "optimize",
        intervalValue: 5,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("weekly");
  });

  it("rejects invalid dayOfWeek for weekly crons", async () => {
    mockAuthenticatedAsAdmin();
    const res = await PATCH(
      makePatchRequest({
        cronName: "optimize",
        dayOfWeek: "INVALID",
        hourUtc: 10,
      })
    );
    expect(res.status).toBe(400);
  });

  // ─── Successful PATCH ─────────────────────────────────────────────

  it("updates rate cron successfully with EventBridge sync", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.update as jest.Mock).mockResolvedValue({
      ...mockConfigs[0],
      intervalValue: 5,
      scheduleExpression: "rate(5 minutes)",
    });
    mockUpdateCronSchedule.mockResolvedValue({
      success: true,
      ruleArn: "arn:aws:events:us-east-1:123:rule/test",
    });

    const res = await PATCH(
      makePatchRequest({
        cronName: "publish",
        intervalValue: 5,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warning).toBeUndefined();

    // First DB call sets PENDING, second call promotes to SYNCED
    expect(prismaMock.cronConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cronName: "publish" },
        data: expect.objectContaining({
          intervalValue: 5,
          intervalUnit: "minutes",
          syncStatus: "PENDING",
        }),
      })
    );
    expect(prismaMock.cronConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cronName: "publish" },
        data: { syncStatus: "SYNCED" },
      })
    );
    expect(mockUpdateCronSchedule).toHaveBeenCalledWith(
      "publish",
      "rate(5 minutes)"
    );
  });

  it("handles EventBridge failure gracefully (syncStatus: PENDING)", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.update as jest.Mock).mockResolvedValue({
      ...mockConfigs[0],
      intervalValue: 3,
      syncStatus: "PENDING",
    });
    mockUpdateCronSchedule.mockResolvedValue({
      success: false,
      reason: "internal-error",
      message: "Service unavailable",
    });

    const res = await PATCH(
      makePatchRequest({
        cronName: "publish",
        intervalValue: 3,
        intervalUnit: "minutes",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warning).toBe("EventBridge sync pending");
  });

  it("updates enabled field and calls enable/disable", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.update as jest.Mock).mockResolvedValue({
      ...mockConfigs[0],
      enabled: false,
    });
    mockDisableCron.mockResolvedValue({ success: true });

    const res = await PATCH(
      makePatchRequest({ cronName: "publish", enabled: false })
    );
    expect(res.status).toBe(200);
    expect(mockDisableCron).toHaveBeenCalledWith("publish");
  });

  it("updates weekly cron schedule", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.update as jest.Mock).mockResolvedValue({
      ...mockConfigs[2],
      dayOfWeek: "MON",
      hourUtc: 15,
    });
    mockUpdateCronSchedule.mockResolvedValue({
      success: true,
      ruleArn: "arn:test",
    });

    const res = await PATCH(
      makePatchRequest({
        cronName: "optimize",
        dayOfWeek: "MON",
        hourUtc: 15,
      })
    );
    expect(res.status).toBe(200);
    expect(mockUpdateCronSchedule).toHaveBeenCalledWith(
      "optimize",
      "cron(0 15 ? * MON *)"
    );
  });

  it("returns 500 on database error", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronConfig.update as jest.Mock).mockRejectedValue(
      new Error("DB error")
    );

    const res = await PATCH(
      makePatchRequest({ cronName: "publish", enabled: false })
    );
    expect(res.status).toBe(500);
  });
});
