import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/briefs/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/briefs");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString());
}

describe("GET /api/briefs", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);
    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(403);
  });

  it("returns briefs for a valid member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const fakeBriefs = [
      { id: "cb-1", topic: "AI Trends", status: "PENDING", platform: "TWITTER" },
    ];
    prismaMock.contentBrief.findMany.mockResolvedValue(fakeBriefs as any);

    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].topic).toBe("AI Trends");
  });

  it("filters by status", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1", status: "FULFILLED" }));

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "FULFILLED" }),
      })
    );
  });

  it("orders by sortOrder then scheduledFor", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sortOrder: "asc" }, { scheduledFor: "asc" }],
      })
    );
  });
});
