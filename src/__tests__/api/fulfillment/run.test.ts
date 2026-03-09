import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/fulfillment");

import { POST } from "@/app/api/fulfillment/run/route";
import { runFulfillment } from "@/lib/fulfillment";
import { NextRequest } from "next/server";

const mockRunFulfillment = runFulfillment as jest.MockedFunction<typeof runFulfillment>;

function makeRequest() {
  return new NextRequest("http://localhost/api/fulfillment/run", { method: "POST" });
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockRunFulfillment.mockResolvedValue({ processed: 2, created: 1, skipped: 1, failed: 0 });
});

describe("POST /api/fulfillment/run", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-owner members", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "MEMBER",
      joinedAt: new Date(),
    } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
  });

  it("triggers fulfillment for owner", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
      joinedAt: new Date(),
    } as never);

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(mockRunFulfillment).toHaveBeenCalledWith("biz-1");
    const body = await res.json();
    expect(body.created).toBe(1);
  });
});
