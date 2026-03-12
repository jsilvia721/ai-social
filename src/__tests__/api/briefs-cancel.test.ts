import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockAuthenticatedAsAdmin, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { PATCH } from "@/app/api/briefs/[id]/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(id: string) {
  return [
    new NextRequest(`http://localhost/api/briefs/${id}`, { method: "PATCH" }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

describe("PATCH /api/briefs/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const [req, ctx] = makeRequest("cb-1");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when brief not found", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(null);
    const [req, ctx] = makeRequest("cb-999");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const [req, ctx] = makeRequest("cb-1");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 400 when brief is not PENDING", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "FULFILLED",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
  });

  it("admin bypasses membership check", async () => {
    mockAuthenticatedAsAdmin();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
    } as any);
    prismaMock.contentBrief.update.mockResolvedValue({
      id: "cb-1", status: "CANCELLED",
    } as any);

    const [req, ctx] = makeRequest("cb-1");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    // Admin should NOT trigger membership lookup
    expect(prismaMock.businessMember.findUnique).not.toHaveBeenCalled();
  });

  it("cancels PENDING brief and returns updated brief", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentBrief.update.mockResolvedValue({
      id: "cb-1", status: "CANCELLED",
    } as any);

    const [req, ctx] = makeRequest("cb-1");
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("CANCELLED");
  });
});
