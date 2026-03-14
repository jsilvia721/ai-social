import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/metrics");

import { POST } from "@/app/api/posts/[id]/refresh-metrics/route";
import { getPostMetrics } from "@/lib/blotato/metrics";
import { NextRequest } from "next/server";

const mockGetPostMetrics = getPostMetrics as jest.MockedFunction<typeof getPostMetrics>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(id: string) {
  return {
    req: new NextRequest(`http://localhost/api/posts/${id}/refresh-metrics`, {
      method: "POST",
    }),
    params: { params: Promise.resolve({ id }) },
  };
}

describe("POST /api/posts/[id]/refresh-metrics", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const { req, params } = makeRequest("post-1");

    const res = await POST(req, params);

    expect(res.status).toBe(401);
  });

  it("returns 404 when post does not exist", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue(null);
    const { req, params } = makeRequest("nonexistent");

    const res = await POST(req, params);

    expect(res.status).toBe(404);
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith({
      where: {
        id: "nonexistent",
        business: { members: { some: { userId: mockSession.user.id } } },
      },
    });
  });

  it("returns 400 when post has no blotatoPostId", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "post-1",
      blotatoPostId: null,
    } as any);
    const { req, params } = makeRequest("post-1");

    const res = await POST(req, params);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "Post has no Blotato ID — it may not have been published via Blotato"
    );
  });

  it("returns 200 with updated metrics on success", async () => {
    mockAuthenticated();
    const metricsUpdatedAt = new Date("2026-03-13T12:00:00Z");
    const metrics = {
      likes: 10,
      comments: 5,
      shares: 3,
      impressions: 1000,
      reach: 800,
      saves: 2,
    };
    prismaMock.post.findFirst.mockResolvedValue({
      id: "post-1",
      blotatoPostId: "blotato-123",
    } as any);
    mockGetPostMetrics.mockResolvedValue(metrics);
    prismaMock.post.update.mockResolvedValue({
      id: "post-1",
      ...metrics,
      metricsUpdatedAt,
    } as any);

    const { req, params } = makeRequest("post-1");
    const res = await POST(req, params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toEqual(metrics);
    expect(new Date(body.metricsUpdatedAt).getTime()).not.toBeNaN();
    expect(mockGetPostMetrics).toHaveBeenCalledWith("blotato-123");
    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: {
        ...metrics,
        metricsUpdatedAt: expect.any(Date),
      },
    });
  });

  it("returns 502 when getPostMetrics throws", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "post-1",
      blotatoPostId: "blotato-123",
    } as any);
    mockGetPostMetrics.mockRejectedValue(new Error("Blotato API timeout"));

    const { req, params } = makeRequest("post-1");
    const res = await POST(req, params);

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Blotato API timeout");
  });
});
