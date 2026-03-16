import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/posts/calendar/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/posts/calendar");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

describe("GET /api/posts/calendar", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ year: "2025", month: "5" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing year/month and no date range", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns posts for a given year/month without businessId filter", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ year: "2025", month: "5" }));

    expect(res.status).toBe(200);
    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ businessId: expect.anything() }),
      })
    );
  });

  it("filters by businessId when provided", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ year: "2025", month: "5", businessId: "biz-1" }));

    expect(res.status).toBe(200);
    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-1" }),
      })
    );
  });

  it("filters by businessId using startDate/endDate range", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(
      makeRequest({
        startDate: "2025-06-01T00:00:00.000Z",
        endDate: "2025-06-08T00:00:00.000Z",
        businessId: "biz-2",
      })
    );

    expect(res.status).toBe(200);
    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-2" }),
      })
    );
  });

  it("filters by socialAccount.businessId when businessId is provided", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest({ year: "2025", month: "5", businessId: "biz-1" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          socialAccount: { businessId: "biz-1" },
        }),
      })
    );
  });

  it("does not add socialAccount filter when businessId is absent", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest({ year: "2025", month: "5" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          socialAccount: expect.anything(),
        }),
      })
    );
  });

  it("always scopes to the user's business membership", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest({ year: "2025", month: "5", businessId: "biz-1" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { members: { some: { userId: "user-test-id" } } },
        }),
      })
    );
  });
});
