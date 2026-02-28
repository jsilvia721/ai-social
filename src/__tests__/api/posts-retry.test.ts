import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/posts/[id]/retry/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest() {
  return new NextRequest("http://localhost/api/posts/post-1/retry", { method: "POST" });
}

const params = Promise.resolve({ id: "post-1" });

describe("POST /api/posts/[id]/retry", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(401);
  });

  it("returns 404 when post not found or belongs to another user", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(404);
    expect(prismaMock.post.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "post-1", userId: mockSession.user.id }),
      })
    );
  });

  it("returns 400 when post is not FAILED", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "SCHEDULED" } as any);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(400);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("resets a FAILED post to SCHEDULED and clears errorMessage", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({
      id: "post-1",
      status: "FAILED",
      errorMessage: "Twitter API error",
    } as any);
    prismaMock.post.update.mockResolvedValue({
      id: "post-1",
      status: "SCHEDULED",
      errorMessage: null,
    } as any);

    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1" },
        data: expect.objectContaining({ status: "SCHEDULED", errorMessage: null }),
      })
    );
  });

  it("returns the updated post", async () => {
    mockAuthenticated();
    prismaMock.post.findFirst.mockResolvedValue({ id: "post-1", status: "FAILED" } as any);
    prismaMock.post.update.mockResolvedValue({
      id: "post-1",
      status: "SCHEDULED",
      errorMessage: null,
    } as any);

    const res = await POST(makeRequest(), { params });
    const body = await res.json();

    expect(body.status).toBe("SCHEDULED");
    expect(body.errorMessage).toBeNull();
  });
});
