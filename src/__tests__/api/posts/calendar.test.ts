import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/posts/calendar/route";
import { NextRequest } from "next/server";

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/posts/calendar");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/posts/calendar", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ year: "2026", month: "0" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing year/month", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid month (out of range)", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ year: "2026", month: "12" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-numeric params", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ year: "abc", month: "0" }));
    expect(res.status).toBe(400);
  });

  it("returns posts for the given month range", async () => {
    mockAuthenticated();
    const fakePosts = [
      {
        id: "p1",
        content: "Hello",
        status: "SCHEDULED",
        scheduledAt: new Date("2026-01-15T10:00:00Z"),
        socialAccount: { platform: "TWITTER", username: "testuser" },
      },
    ];
    prismaMock.post.findMany.mockResolvedValue(fakePosts as any);

    const res = await GET(makeRequest({ year: "2026", month: "0" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("p1");
  });

  it("queries with correct date range for the month", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest({ year: "2026", month: "2" })); // March

    const call = prismaMock.post.findMany.mock.calls[0]?.[0] as { where: { userId: string; scheduledAt: { gte: Date; lt: Date } } };
    expect(call.where.userId).toBe(mockSession.user.id);
    expect(call.where.scheduledAt.gte).toEqual(new Date(2026, 2, 1)); // Mar 1
    expect(call.where.scheduledAt.lt).toEqual(new Date(2026, 3, 1));  // Apr 1
  });

  it("handles month=11 (December) without overflow", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest({ year: "2026", month: "11" }));
    expect(res.status).toBe(200);

    const call = prismaMock.post.findMany.mock.calls[0]?.[0] as { where: { scheduledAt: { gte: Date; lt: Date } } };
    expect(call.where.scheduledAt.gte).toEqual(new Date(2026, 11, 1)); // Dec 1
    expect(call.where.scheduledAt.lt).toEqual(new Date(2027, 0, 1));  // Jan 1 next year
  });
});
