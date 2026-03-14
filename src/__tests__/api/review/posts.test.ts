import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import {
  mockAuthenticated,
  mockAuthenticatedAsAdmin,
  mockUnauthenticated,
  mockSession,
} from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: jest.fn(),
}));

import { GET } from "@/app/api/review/posts/route";
import { NextRequest } from "next/server";
import { reportServerError } from "@/lib/server-error-reporter";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest() {
  return new NextRequest("http://localhost/api/review/posts");
}

describe("GET /api/review/posts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
  });

  it("returns empty posts when no activeBusinessId", async () => {
    mockAuthenticated({
      ...mockSession,
      user: { ...mockSession.user, activeBusinessId: null as any },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toEqual([]);
  });

  it("returns serialized PENDING_REVIEW posts for member", async () => {
    mockAuthenticated();

    const now = new Date("2026-03-14T12:00:00Z");
    const later = new Date("2026-03-15T12:00:00Z");

    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        content: "Test post",
        mediaUrls: [],
        status: "PENDING_REVIEW",
        scheduledAt: now,
        reviewWindowExpiresAt: later,
        briefId: "brief-1",
        socialAccount: { platform: "TWITTER", username: "testuser" },
        contentBrief: { id: "brief-1", topic: "AI", recommendedFormat: "thread" },
      },
    ] as any);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].id).toBe("post-1");
    expect(body.posts[0].scheduledAt).toBe("2026-03-14T12:00:00.000Z");
    expect(body.posts[0].reviewWindowExpiresAt).toBe("2026-03-15T12:00:00.000Z");
    expect(body.posts[0].socialAccount.platform).toBe("TWITTER");
  });

  it("scopes query to activeBusinessId with membership filter for non-admin", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz-1",
          status: "PENDING_REVIEW",
          business: {
            members: {
              some: { userId: "user-test-id" },
            },
          },
        }),
      })
    );
  });

  it("skips membership filter for admin users", async () => {
    mockAuthenticatedAsAdmin();

    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-2",
        content: "Admin post",
        mediaUrls: [],
        status: "PENDING_REVIEW",
        scheduledAt: null,
        reviewWindowExpiresAt: null,
        briefId: null,
        socialAccount: { platform: "INSTAGRAM", username: "admin" },
        contentBrief: null,
      },
    ] as any);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].scheduledAt).toBeNull();

    // Should NOT include business.members filter for admin
    const callArgs = prismaMock.post.findMany.mock.calls[0][0] as any;
    expect(callArgs.where.business).toBeUndefined();
  });

  it("returns 500 and reports error on database failure", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockRejectedValue(new Error("DB connection failed"));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    expect(reportServerError).toHaveBeenCalledWith(
      "DB connection failed",
      expect.objectContaining({ metadata: { context: "GET /api/review/posts" } })
    );
  });
});
