import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/posts/[id]/reject/route";
import { NextRequest } from "next/server";

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/posts/${id}/reject`, { method: "POST" });
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("POST /api/posts/[id]/reject", () => {
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
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PUBLISHED" } as never);
    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(400);
  });

  it("rejects PENDING_REVIEW post → DRAFT + cancels brief", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "p1",
      status: "PENDING_REVIEW",
      briefId: "brief-1",
    } as never);
    prismaMock.$transaction.mockResolvedValue([{ count: 1 }, { count: 1 }]);
    prismaMock.post.findUnique.mockResolvedValue({ id: "p1", status: "DRAFT" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it("is idempotent — returns 200 if already DRAFT", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "DRAFT" } as never);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(200);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("returns 409 when post was auto-approved between read and write", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "p1",
      status: "PENDING_REVIEW",
      briefId: "brief-1",
    } as never);
    // updateMany matches 0 rows — post transitioned between findFirst and transaction
    prismaMock.$transaction.mockResolvedValue([{ count: 0 }, { count: 0 }]);

    const res = await POST(makeRequest("p1"), makeParams("p1"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("no longer in review");
  });
});
