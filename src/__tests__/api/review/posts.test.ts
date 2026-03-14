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

import { GET } from "@/app/api/review/posts/route";
import { NextRequest } from "next/server";

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

  it("returns 400 when no activeBusinessId", async () => {
    mockAuthenticated({
      ...mockSession,
      user: { ...mockSession.user, activeBusinessId: null as any },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
  });

  it("returns 403 when non-admin user lacks membership", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });

  it("returns serialized PENDING_REVIEW posts for member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "mem-1",
    } as any);

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

  it("returns posts for admin without membership check", async () => {
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
    // Membership check should not have been called
    expect(prismaMock.businessMember.findUnique).not.toHaveBeenCalled();
  });

  it("scopes query to activeBusinessId and PENDING_REVIEW status", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "mem-1",
    } as any);
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: "biz-1",
          status: "PENDING_REVIEW",
        },
      })
    );
  });
});
