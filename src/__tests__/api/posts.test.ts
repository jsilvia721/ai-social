import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

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

  it("returns posts for the current user", async () => {
    mockAuthenticated();
    const fakePosts = [{ id: "post-1", content: "hello", status: "DRAFT" }];
    prismaMock.post.findMany.mockResolvedValue(fakePosts as any);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("post-1");
  });

  it("always filters by the current user's id", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: mockSession.user.id }),
      })
    );
  });

  it("passes status filter to the database query when provided", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ status: "SCHEDULED" }));

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });
});

describe("POST /api/posts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await POST(
      makePostRequest({ content: "test", socialAccountId: "acc-1" })
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 when the social account belongs to a different user", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({ content: "test", socialAccountId: "other-users-account" })
    );

    expect(res.status).toBe(404);
    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: mockSession.user.id }),
      })
    );
  });

  it("creates a SCHEDULED post when scheduledAt is provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1" } as any);
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
        scheduledAt: "2025-06-01T12:00:00Z",
      })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });

  it("creates a DRAFT post when no scheduledAt is provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1" } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-draft", status: "DRAFT" } as any);

    const res = await POST(
      makePostRequest({ content: "Draft post", socialAccountId: "acc-1" })
    );

    expect(res.status).toBe(201);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
  });

  it("uses session.user.id as userId (never trusts request body)", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue({ id: "acc-1" } as any);
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    await POST(
      makePostRequest({
        content: "test",
        socialAccountId: "acc-1",
        userId: "attacker-user-id", // should be ignored
      })
    );

    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: mockSession.user.id }),
      })
    );
  });
});
