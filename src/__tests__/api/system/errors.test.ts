import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/system/errors/route";
import { NextRequest } from "next/server";

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/system/errors${query}`);
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/system/errors", () => {
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
    const res = await GET(makeRequest("?range=abc"));
    expect(res.status).toBe(400);
  });

  it("returns 200 with correct shape for admin", async () => {
    mockAuthenticatedAsAdmin();

    const now = new Date();
    (prismaMock.errorReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "err-1",
        fingerprint: "fp1",
        message: "Something broke",
        stack: null,
        source: "SERVER",
        url: "/api/posts",
        metadata: null,
        count: 5,
        firstSeenAt: now,
        lastSeenAt: now,
        status: "NEW",
        githubIssueNumber: null,
        acknowledgedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "err-2",
        fingerprint: "fp2",
        message: "Network error",
        stack: null,
        source: "CLIENT",
        url: "/dashboard",
        metadata: null,
        count: 2,
        firstSeenAt: new Date(now.getTime() - 3600000),
        lastSeenAt: new Date(now.getTime() - 1800000),
        status: "NEW",
        githubIssueNumber: null,
        acknowledgedAt: null,
        createdAt: new Date(now.getTime() - 3600000),
        updatedAt: new Date(now.getTime() - 1800000),
      },
    ]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty("buckets");
    expect(body).toHaveProperty("topErrors");
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(Array.isArray(body.topErrors)).toBe(true);
    expect(body.topErrors.length).toBeLessThanOrEqual(10);
    expect(body.topErrors[0]).toHaveProperty("message");
    expect(body.topErrors[0]).toHaveProperty("count");
    expect(body.topErrors[0]).toHaveProperty("lastSeenAt");
    expect(body.topErrors[0]).toHaveProperty("source");
  });

  it("returns empty response when no data", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.errorReport.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.buckets).toEqual([]);
    expect(body.topErrors).toEqual([]);
  });

  it("accepts valid range params", async () => {
    mockAuthenticatedAsAdmin();
    (prismaMock.errorReport.findMany as jest.Mock).mockResolvedValue([]);

    for (const range of ["24h", "7d", "30d"]) {
      const res = await GET(makeRequest(`?range=${range}`));
      expect(res.status).toBe(200);
    }
  });
});
