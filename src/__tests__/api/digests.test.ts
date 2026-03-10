import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/businesses/[id]/digests/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(businessId: string) {
  return [
    new NextRequest(`http://localhost/api/businesses/${businessId}/digests`),
    { params: Promise.resolve({ id: businessId }) },
  ] as const;
}

const mockDigest = {
  id: "digest-1",
  businessId: "biz-1",
  weekOf: new Date("2026-03-02T00:00:00Z"),
  summary: "Your videos performed 2x better than text posts this week.",
  patterns: { topPerformers: [], insights: ["Videos outperform"] },
  changes: { formatMix: { VIDEO: 0.1 } },
  createdAt: new Date(),
};

describe("GET /api/businesses/[id]/digests", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const [req, params] = makeRequest("biz-1");
    const res = await GET(req, params);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue(null);
    const [req, params] = makeRequest("biz-1");
    const res = await GET(req, params);
    expect(res.status).toBe(403);
  });

  it("returns digests ordered by weekOf desc", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "MEMBER",
      joinedAt: new Date(),
    });
    prismaMock.strategyDigest.findMany.mockResolvedValue([
      mockDigest,
      { ...mockDigest, id: "digest-2", weekOf: new Date("2026-02-24T00:00:00Z") },
    ] as never);

    const [req, params] = makeRequest("biz-1");
    const res = await GET(req, params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.digests).toHaveLength(2);

    // Verify query was called with correct params
    expect(prismaMock.strategyDigest.findMany).toHaveBeenCalledWith({
      where: { businessId: "biz-1" },
      orderBy: { weekOf: "desc" },
      take: 4,
    });
  });

  it("caps at 4 results", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "MEMBER",
      joinedAt: new Date(),
    });
    prismaMock.strategyDigest.findMany.mockResolvedValue([] as never);

    const [req, params] = makeRequest("biz-1");
    await GET(req, params);

    expect(prismaMock.strategyDigest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 4 })
    );
  });

  it("returns empty array when no digests exist", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "MEMBER",
      joinedAt: new Date(),
    });
    prismaMock.strategyDigest.findMany.mockResolvedValue([] as never);

    const [req, params] = makeRequest("biz-1");
    const res = await GET(req, params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.digests).toEqual([]);
  });
});
