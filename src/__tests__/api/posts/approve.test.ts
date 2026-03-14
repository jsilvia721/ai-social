import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/posts/[id]/approve/route";
import { NextRequest } from "next/server";

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/posts/${id}/approve`, { method: "POST" });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("POST /api/posts/[id]/approve", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when post not found", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue(null);
    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when post is not PENDING_REVIEW", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "DRAFT" } as never);
    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Cannot approve");
  });

  it("approves PENDING_REVIEW post → SCHEDULED (atomic updateMany)", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue({ id: "p1", status: "SCHEDULED" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "p1", status: "PENDING_REVIEW" }),
        data: expect.objectContaining({ status: "SCHEDULED", reviewWindowExpiresAt: null }),
      })
    );
  });

  it("returns 400 when approving media-less INSTAGRAM post", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "p1", status: "PENDING_REVIEW", mediaUrls: [],
      socialAccount: { platform: "INSTAGRAM" },
    } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("INSTAGRAM requires at least one image or video");
    expect(prismaMock.post.updateMany).not.toHaveBeenCalled();
  });

  it("allows approving INSTAGRAM post with media", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "p1", status: "PENDING_REVIEW",
      mediaUrls: ["https://storage.example.com/img.jpg"],
      socialAccount: { platform: "INSTAGRAM" },
    } as never);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue({ id: "p1", status: "SCHEDULED" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
  });

  it("is idempotent — returns 200 if already SCHEDULED", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "SCHEDULED" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyApproved).toBe(true);
    expect(prismaMock.post.updateMany).not.toHaveBeenCalled();
  });

  it("returns 409 when post was auto-approved between read and write", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    // updateMany matches 0 rows — post transitioned between findFirst and updateMany
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.post.findUnique.mockResolvedValue({ id: "p1", status: "SCHEDULED" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyApproved).toBe(true);
  });

  it("returns 409 when post transitioned to non-SCHEDULED state", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.post.findUnique.mockResolvedValue({ id: "p1", status: "DRAFT" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("no longer in review");
  });
});
