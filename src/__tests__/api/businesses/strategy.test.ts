import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET, PATCH } from "@/app/api/businesses/[id]/strategy/route";
import { NextRequest } from "next/server";

function makeGetRequest(id: string) {
  return new NextRequest(`http://localhost/api/businesses/${id}/strategy`, { method: "GET" });
}

function makePatchRequest(id: string, body: object) {
  return new NextRequest(`http://localhost/api/businesses/${id}/strategy`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/businesses/[id]/strategy", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeGetRequest("biz-1"), makeParams("biz-1"));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-members", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);
    const res = await GET(makeGetRequest("biz-1"), makeParams("biz-1"));
    expect(res.status).toBe(403);
  });

  it("returns strategy for members", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "mem-1" } as never);
    prismaMock.contentStrategy.findUnique.mockResolvedValue({
      reviewWindowEnabled: false,
      reviewWindowHours: 24,
      postingCadence: null,
      formatMix: null,
    } as never);

    const res = await GET(makeGetRequest("biz-1"), makeParams("biz-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewWindowEnabled).toBe(false);
  });
});

describe("PATCH /api/businesses/[id]/strategy", () => {
  it("updates review window settings with Zod validation", async () => {
    mockAuthenticated();
    const updatedAt = new Date("2026-03-09T10:00:00Z");
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "mem-1", role: "OWNER" } as never);
    prismaMock.contentStrategy.findUnique.mockResolvedValue({ updatedAt } as never);
    prismaMock.contentStrategy.update.mockResolvedValue({
      reviewWindowEnabled: true,
      reviewWindowHours: 12,
    } as never);

    const res = await PATCH(
      makePatchRequest("biz-1", { updatedAt: updatedAt.toISOString(), reviewWindowEnabled: true, reviewWindowHours: 12 }),
      makeParams("biz-1")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reviewWindowEnabled).toBe(true);
    expect(body.reviewWindowHours).toBe(12);
  });

  it("rejects invalid reviewWindowHours", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "mem-1", role: "OWNER" } as never);

    const res = await PATCH(
      makePatchRequest("biz-1", { updatedAt: "2026-03-09T10:00:00Z", reviewWindowHours: 0 }),
      makeParams("biz-1")
    );
    expect(res.status).toBe(400);
  });

  it("rejects reviewWindowHours > 168 (1 week)", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "mem-1", role: "OWNER" } as never);

    const res = await PATCH(
      makePatchRequest("biz-1", { updatedAt: "2026-03-09T10:00:00Z", reviewWindowHours: 200 }),
      makeParams("biz-1")
    );
    expect(res.status).toBe(400);
  });
});
