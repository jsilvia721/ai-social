import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { PATCH } from "@/app/api/briefs/reorder/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/briefs/reorder", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PATCH /api/briefs/reorder", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await PATCH(makeRequest({ briefIds: ["cb-1"] }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid body", async () => {
    mockAuthenticated();
    const res = await PATCH(makeRequest({ briefIds: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when some briefs not found", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([
      { id: "cb-1", businessId: "biz-1" },
    ] as any);

    const res = await PATCH(makeRequest({ briefIds: ["cb-1", "cb-2"] }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when briefs belong to different businesses", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([
      { id: "cb-1", businessId: "biz-1" },
      { id: "cb-2", businessId: "biz-2" },
    ] as any);

    const res = await PATCH(makeRequest({ briefIds: ["cb-1", "cb-2"] }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([
      { id: "cb-1", businessId: "biz-1" },
      { id: "cb-2", businessId: "biz-1" },
    ] as any);
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ briefIds: ["cb-1", "cb-2"] }));
    expect(res.status).toBe(403);
  });

  it("updates sortOrder for each brief and returns success", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findMany.mockResolvedValue([
      { id: "cb-1", businessId: "biz-1" },
      { id: "cb-2", businessId: "biz-1" },
      { id: "cb-3", businessId: "biz-1" },
    ] as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.$transaction.mockResolvedValue([{}, {}, {}] as any);

    const res = await PATCH(makeRequest({ briefIds: ["cb-3", "cb-1", "cb-2"] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
