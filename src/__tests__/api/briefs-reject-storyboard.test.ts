import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/briefs/[id]/reject-storyboard/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(id: string) {
  return [
    new NextRequest(`http://localhost/api/briefs/${id}/reject-storyboard`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

const storyboardBrief = {
  id: "cb-1",
  businessId: "biz-1",
  status: "STORYBOARD_REVIEW",
} as any;

describe("POST /api/briefs/[id]/reject-storyboard", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when brief not found", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(null);
    const [req, ctx] = makeRequest("cb-999");
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 409 when brief is not in STORYBOARD_REVIEW", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      ...storyboardBrief,
      status: "FULFILLED",
    });
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("STORYBOARD_REVIEW");
  });

  it("transitions brief to CANCELLED and returns 200", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentBrief.update.mockResolvedValue({
      ...storyboardBrief,
      status: "CANCELLED",
    });

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "cb-1" },
      data: { status: "CANCELLED" },
    });
  });
});
