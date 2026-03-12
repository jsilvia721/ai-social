import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockAuthenticatedAsAdmin, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/briefs/counts/route";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/briefs/counts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty object when user has no memberships", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findMany.mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({});
  });

  it("returns pending counts per business", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findMany.mockResolvedValue([
      { businessId: "biz-1" },
      { businessId: "biz-2" },
    ] as any);

    prismaMock.contentBrief.groupBy.mockResolvedValue([
      { businessId: "biz-1", _count: { id: 3 } },
      { businessId: "biz-2", _count: { id: 1 } },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ "biz-1": 3, "biz-2": 1 });
  });

  it("admin gets counts across all businesses without membership filter", async () => {
    mockAuthenticatedAsAdmin();
    prismaMock.contentBrief.groupBy.mockResolvedValue([
      { businessId: "biz-1", _count: { id: 5 } },
      { businessId: "biz-other", _count: { id: 2 } },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ "biz-1": 5, "biz-other": 2 });
    // Admin should NOT query memberships
    expect(prismaMock.businessMember.findMany).not.toHaveBeenCalled();
  });

  it("omits businesses with zero pending briefs", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findMany.mockResolvedValue([
      { businessId: "biz-1" },
    ] as any);
    prismaMock.contentBrief.groupBy.mockResolvedValue([] as any);

    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({});
  });
});
