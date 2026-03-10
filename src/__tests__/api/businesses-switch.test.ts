import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockAuthenticatedAsAdmin, mockUnauthenticated, mockSession, mockAdminSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/businesses/switch/route";
import { NextRequest } from "next/server";

function makeRequest(body?: object) {
  return new NextRequest("http://localhost/api/businesses/switch", {
    method: "POST",
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("POST /api/businesses/switch", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("businessId");
  });

  it("returns 403 when user is not a member of the business", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest({ businessId: "biz-other" }));
    expect(res.status).toBe(403);
    expect(prismaMock.businessMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: mockSession.user.id, businessId: "biz-other" },
      })
    );
  });

  it("updates user.activeBusinessId and returns the businessId on success", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
      joinedAt: new Date(),
    } as any);
    prismaMock.user.update.mockResolvedValue({ id: mockSession.user.id } as any);

    const res = await POST(makeRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeBusinessId).toBe("biz-1");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockSession.user.id },
      data: { activeBusinessId: "biz-1" },
    });
  });

  it("admin can switch to any business without being a member", async () => {
    mockAuthenticatedAsAdmin();
    prismaMock.user.update.mockResolvedValue({ id: mockAdminSession.user.id } as any);

    const res = await POST(makeRequest({ businessId: "biz-other" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeBusinessId).toBe("biz-other");
    // Admin skips the membership check — businessMember.findFirst should NOT be called
    expect(prismaMock.businessMember.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: mockAdminSession.user.id },
      data: { activeBusinessId: "biz-other" },
    });
  });
});
