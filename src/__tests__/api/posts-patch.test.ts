import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { PATCH } from "@/app/api/posts/[id]/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/posts/post-1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ id: "post-1" });

describe("PATCH /api/posts/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await PATCH(makeRequest({ content: "updated" }), { params });

    expect(res.status).toBe(401);
  });

  it("returns 404 when post not found or belongs to another user", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await PATCH(makeRequest({ content: "updated" }), { params });

    expect(res.status).toBe(404);
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "post-1", userId: mockSession.user.id }),
      })
    );
  });

  it("returns 400 when post is PUBLISHED", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "PUBLISHED" } as any);

    const res = await PATCH(makeRequest({ content: "updated" }), { params });

    expect(res.status).toBe(400);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("updates content and returns the post", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "DRAFT" } as any);
    const updated = { id: "post-1", content: "new content", status: "DRAFT" };
    prismaMock.post.update.mockResolvedValue(updated as any);

    const res = await PATCH(makeRequest({ content: "new content" }), { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toBe("new content");
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "new content" }),
      })
    );
  });

  it("sets status SCHEDULED when scheduledAt is provided", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "DRAFT" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "post-1", status: "SCHEDULED" } as any);

    await PATCH(makeRequest({ scheduledAt: "2027-01-01T12:00:00Z" }), { params });

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });

  it("sets status DRAFT when scheduledAt is null", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "SCHEDULED" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "post-1", status: "DRAFT" } as any);

    await PATCH(makeRequest({ scheduledAt: null }), { params });

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT", scheduledAt: null }),
      })
    );
  });
});
