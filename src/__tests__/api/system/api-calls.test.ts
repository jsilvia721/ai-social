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

    (prismaMock.apiCall.findMany as jest.Mock).mockResolvedValue([
      {
        service: "blotato",
        statusCode: 200,
        latencyMs: 150,
        error: null,
        createdAt: new Date(),
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({
      buckets: expect.arrayContaining([
        expect.objectContaining({
          timestamp: expect.any(String),
          service: "blotato",
          count: 1,
          avgLatencyMs: 150,
          errorCount: 0,
        }),
      ]),
      summary: {
        totalCalls: 1,
        avgLatencyMs: 150,
        errorRate: 0,
        byService: { blotato: { count: 1, avgLatencyMs: 150 } },
      },
    });
  });

  it("returns empty response when no data", async () => {
    mockAuthenticatedAsAdmin();

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

    (prismaMock.apiCall.findMany as jest.Mock).mockResolvedValue([]);

    for (const range of ["24h", "7d", "30d"]) {
      const res = await GET(makeRequest(`?range=${range}`));
      expect(res.status).toBe(200);
    }
  });

  it("returns 500 when database query fails", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.apiCall.findMany as jest.Mock).mockRejectedValue(
      new Error("Connection refused")
    );
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
