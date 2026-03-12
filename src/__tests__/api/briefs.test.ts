import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockAuthenticatedAsAdmin, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

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
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns briefs scoped to user memberships", async () => {
    mockAuthenticated();

    const fakeBriefs = [
      { id: "cb-1", topic: "AI Trends", status: "PENDING", platform: "TWITTER" },
    ];
    prismaMock.contentBrief.findMany.mockResolvedValue(fakeBriefs as any);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].topic).toBe("AI Trends");
  });

  it("filters by status", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ status: "FULFILLED" }));

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "FULFILLED" }),
      })
    );
  });

  it("filters by businessId when provided", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-1" }),
      })
    );
  });

  it("admin bypasses membership filter", async () => {
    mockAuthenticatedAsAdmin();
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    const call = prismaMock.contentBrief.findMany.mock.calls[0][0];
    // Admin should NOT have the business.members filter
    expect(call?.where).not.toHaveProperty("business");
  });

  it("non-admin has membership filter", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { members: { some: { userId: mockSession.user.id } } },
        }),
      })
    );
  });

  it("orders by sortOrder then scheduledFor", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sortOrder: "asc" }, { scheduledFor: "asc" }],
      })
    );
  });
});
