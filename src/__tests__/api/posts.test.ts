import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockAuthenticatedAsAdmin, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET, POST } from "@/app/api/posts/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/posts");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString());
}

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/posts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("GET /api/posts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
  });

  it("returns paginated posts with total count", async () => {
    mockAuthenticated();
    const fakePosts = [{ id: "post-1", content: "hello", status: "DRAFT" }];
    prismaMock.$transaction.mockResolvedValue([fakePosts, 1] as any);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].id).toBe("post-1");
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(50);
  });

  it("respects page and limit query params", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 100] as any);

    const res = await GET(makeGetRequest({ page: "3", limit: "20" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(3);
    expect(body.limit).toBe(20);
    expect(body.total).toBe(100);
  });

  it("caps limit at 200", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest({ limit: "999" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 })
    );
  });

  it("always filters by the current user's business membership", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { members: { some: { userId: mockSession.user.id } } },
        }),
      })
    );
  });

  it("passes status filter to the database query when provided", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest({ status: "SCHEDULED" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });

  it("filters by businessId when provided", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-1" }),
      })
    );
  });

  it("filters by socialAccount.businessId when businessId is provided", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          socialAccount: { businessId: "biz-1" },
        }),
      })
    );
  });

  it("does not add socialAccount filter when businessId is absent", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          socialAccount: expect.anything(),
        }),
      })
    );
  });

  it("does not add businessId filter when param is absent", async () => {
    mockAuthenticated();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ businessId: expect.anything() }),
      })
    );
  });

  it("admin bypasses membership filter", async () => {
    mockAuthenticatedAsAdmin();
    prismaMock.$transaction.mockResolvedValue([[], 0] as any);

    await GET(makeGetRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          business: expect.anything(),
        }),
      })
    );
  });
});

describe("POST /api/posts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await POST(
      makePostRequest({ content: "test", socialAccountId: "acc-1", businessId: "biz-1" })
    );

    expect(res.status).toBe(401);
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();

    const res = await POST(
      makePostRequest({ content: "test", socialAccountId: "acc-1" })
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 when the social account does not belong to the business", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({ content: "test", socialAccountId: "other-account", businessId: "biz-1" })
    );

    expect(res.status).toBe(404);
    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz-1",
          business: { members: { some: { userId: mockSession.user.id } } },
        }),
      })
    );
  });

  it("creates a SCHEDULED post when scheduledAt is provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);
    const createdPost = {
      id: "post-new",
      content: "Scheduled post",
      status: "SCHEDULED",
      scheduledAt: new Date("2025-06-01T12:00:00Z"),
    };
    prismaMock.post.create.mockResolvedValue(createdPost as any);

    const res = await POST(
      makePostRequest({
        content: "Scheduled post",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        scheduledAt: "2025-06-01T12:00:00Z",
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED", businessId: "biz-1" }),
      })
    );
  });

  it("creates a DRAFT post when no scheduledAt is provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-draft", status: "DRAFT" } as any);

    const res = await POST(
      makePostRequest({ content: "Draft post", socialAccountId: "acc-1", businessId: "biz-1" })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
  });

  it("creates a SCHEDULED post with scheduledAt near now for post-now flow", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);
    prismaMock.post.create.mockResolvedValue({
      id: "post-now",
      content: "Post now",
      status: "SCHEDULED",
      scheduledAt: new Date(),
    } as any);

    const now = new Date().toISOString();
    const res = await POST(
      makePostRequest({
        content: "Post now",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        scheduledAt: now,
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
    // The scheduledAt should be set (not null)
    const createCall = prismaMock.post.create.mock.calls[0][0];
    expect(createCall.data.scheduledAt).toBeTruthy();
  });

  it("passes coverImageUrl to prisma when provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-1", coverImageUrl: "https://storage.example.com/cover.jpg" } as any);

    const res = await POST(
      makePostRequest({
        content: "test",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        coverImageUrl: "https://storage.example.com/cover.jpg",
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coverImageUrl: "https://storage.example.com/cover.jpg" }),
      })
    );
  });

  it("rejects coverImageUrl that fails SSRF validation", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);

    const res = await POST(
      makePostRequest({
        content: "test",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        coverImageUrl: "https://evil.com/cover.jpg",
      })
    );

    expect(res.status).toBe(400);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it("returns 400 when scheduling INSTAGRAM post without media", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", businessId: "biz-1", platform: "INSTAGRAM",
    } as any);

    const res = await POST(
      makePostRequest({
        content: "No media post",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        scheduledAt: "2027-06-01T12:00:00Z",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("INSTAGRAM requires at least one image or video");
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it("returns 400 when scheduling TIKTOK post without media", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", businessId: "biz-1", platform: "TIKTOK",
    } as any);

    const res = await POST(
      makePostRequest({
        content: "No media post",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        scheduledAt: "2027-06-01T12:00:00Z",
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("TIKTOK requires at least one image or video");
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it("allows DRAFT INSTAGRAM post without media", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", businessId: "biz-1", platform: "INSTAGRAM",
    } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-draft", status: "DRAFT" } as any);

    const res = await POST(
      makePostRequest({
        content: "Draft IG post",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        // no scheduledAt → DRAFT
      })
    );

    expect(res.status).toBe(201);
  });

  it("allows scheduling INSTAGRAM post with media", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({
      id: "acc-1", businessId: "biz-1", platform: "INSTAGRAM",
    } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-1", status: "SCHEDULED" } as any);

    const res = await POST(
      makePostRequest({
        content: "IG post with media",
        socialAccountId: "acc-1",
        businessId: "biz-1",
        scheduledAt: "2027-06-01T12:00:00Z",
        mediaUrls: ["https://storage.example.com/image.jpg"],
      })
    );

    expect(res.status).toBe(201);
  });

  it("uses businessId from the request body (never trusts implicit context)", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1", businessId: "biz-1" } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    await POST(
      makePostRequest({
        content: "test",
        socialAccountId: "acc-1",
        businessId: "biz-1",
      })
    );

    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ businessId: "biz-1" }),
      })
    );
  });
});
