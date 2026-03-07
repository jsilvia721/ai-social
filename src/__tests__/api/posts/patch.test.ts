import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { PATCH } from "@/app/api/posts/[id]/route";
import { NextRequest } from "next/server";

function makePatchRequest(id: string, body: object) {
  return new NextRequest(`http://localhost/api/posts/${id}`, {
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

describe("PATCH /api/posts/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await PATCH(makePatchRequest("p1", { content: "x" }), makeParams("p1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when post not found", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest("p1", { content: "x" }), makeParams("p1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when editing a published post", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "PUBLISHED" } as any);
    const res = await PATCH(makePatchRequest("p1", { content: "x" }), makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cannot edit a published post");
  });

  it("allows editing a FAILED post", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "FAILED" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "p1", content: "updated" } as any);
    const res = await PATCH(makePatchRequest("p1", { content: "updated" }), makeParams("p1"));
    expect(res.status).toBe(200);
  });

  it("returns 400 when scheduledAt is in the past", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "SCHEDULED" } as any);
    const pastDate = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago
    const res = await PATCH(makePatchRequest("p1", { scheduledAt: pastDate }), makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Cannot schedule a post in the past");
  });

  it("returns 400 when scheduledAt is invalid", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "SCHEDULED" } as any);
    const res = await PATCH(makePatchRequest("p1", { scheduledAt: "not-a-date" }), makeParams("p1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid scheduledAt date");
  });

  it("allows scheduledAt in the future", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "SCHEDULED" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "p1", status: "SCHEDULED" } as any);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now
    const res = await PATCH(makePatchRequest("p1", { scheduledAt: futureDate }), makeParams("p1"));
    expect(res.status).toBe(200);
  });

  it("allows clearing scheduledAt (set to null)", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "SCHEDULED" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "p1", status: "DRAFT", scheduledAt: null } as any);
    const res = await PATCH(makePatchRequest("p1", { scheduledAt: null }), makeParams("p1"));
    expect(res.status).toBe(200);
  });

  it("updates content without touching scheduledAt", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", userId: mockSession.user.id, status: "DRAFT" } as any);
    prismaMock.post.update.mockResolvedValue({ id: "p1", content: "new content" } as any);
    const res = await PATCH(makePatchRequest("p1", { content: "new content" }), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "new content" }),
      })
    );
  });
});
