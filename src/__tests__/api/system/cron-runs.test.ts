import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/system/cron-runs/route";
import { NextRequest } from "next/server";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/system/cron-runs${query}`);
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/system/cron-runs", () => {
  it("returns 401 without session", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid range", async () => {
    mockAuthenticatedAsAdmin();
    const res = await GET(makeRequest("?range=99x"));
    expect(res.status).toBe(400);
  });

  it("returns 200 with correct shape for admin", async () => {
    mockAuthenticatedAsAdmin();

    const now = new Date();
    (prismaMock.cronRun.findMany as jest.Mock).mockResolvedValue([
      {
        id: "cr-1",
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: 3,
        durationMs: 1200,
        error: null,
        metadata: null,
        startedAt: now,
        completedAt: new Date(now.getTime() + 1200),
      },
      {
        id: "cr-2",
        cronName: "publish",
        status: "FAILED",
        itemsProcessed: 0,
        durationMs: 500,
        error: "timeout",
        metadata: null,
        startedAt: new Date(now.getTime() - 60000),
        completedAt: new Date(now.getTime() - 59500),
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("crons");
    expect(body.crons).toHaveProperty("publish");
    expect(body.crons.publish).toHaveProperty("runs");
    expect(body.crons.publish).toHaveProperty("successRate");
    expect(body.crons.publish).toHaveProperty("lastRunAt");
    expect(body.crons.publish).toHaveProperty("avgDurationMs");
    expect(body.crons.publish.runs).toHaveLength(2);
    expect(body.crons.publish.successRate).toBe(0.5);
  });

  it("returns empty crons when no data", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronRun.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.crons).toEqual({});
  });

  it("accepts valid range params", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.cronRun.findMany as jest.Mock).mockResolvedValue([]);

    for (const range of ["24h", "7d", "30d"]) {
      const res = await GET(makeRequest(`?range=${range}`));
      expect(res.status).toBe(200);
    }
  });
});
