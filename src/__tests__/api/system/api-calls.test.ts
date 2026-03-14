import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/system/api-calls/route";
import { NextRequest } from "next/server";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/system/api-calls${query}`);
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/system/api-calls", () => {
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
    const res = await GET(makeRequest("?range=1y"));
    expect(res.status).toBe(400);
  });

  it("returns 200 with correct shape for admin (default range)", async () => {
    mockAuthenticatedAsAdmin();

    // groupBy for summary
    (prismaMock.apiCall.groupBy as jest.Mock).mockResolvedValue([
      {
        service: "blotato",
        _count: { _all: 10 },
        _avg: { latencyMs: 200 },
      },
    ]);

    // findMany for time-series bucketing
    (prismaMock.apiCall.findMany as jest.Mock).mockResolvedValue([
      {
        id: "ac-1",
        service: "blotato",
        endpoint: "publishPost",
        method: "POST",
        statusCode: 200,
        latencyMs: 150,
        error: null,
        metadata: null,
        createdAt: new Date(),
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("buckets");
    expect(body).toHaveProperty("summary");
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.summary).toHaveProperty("totalCalls");
    expect(body.summary).toHaveProperty("avgLatencyMs");
    expect(body.summary).toHaveProperty("errorRate");
    expect(body.summary).toHaveProperty("byService");
  });

  it("returns empty response when no data", async () => {
    mockAuthenticatedAsAdmin();

    (prismaMock.apiCall.groupBy as jest.Mock).mockResolvedValue([]);
    (prismaMock.apiCall.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.buckets).toEqual([]);
    expect(body.summary.totalCalls).toBe(0);
    expect(body.summary.avgLatencyMs).toBe(0);
    expect(body.summary.errorRate).toBe(0);
    expect(body.summary.byService).toEqual({});
  });

  it("accepts valid range params", async () => {
    mockAuthenticatedAsAdmin();

    (prismaMock.apiCall.groupBy as jest.Mock).mockResolvedValue([]);
    (prismaMock.apiCall.findMany as jest.Mock).mockResolvedValue([]);

    for (const range of ["24h", "7d", "30d"]) {
      const res = await GET(makeRequest(`?range=${range}`));
      expect(res.status).toBe(200);
    }
  });
});
