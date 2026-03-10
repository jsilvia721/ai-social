import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated } from "@/__tests__/mocks/auth";

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
  mockAuthenticated();
});

describe("PATCH /api/posts/[id] — PENDING_REVIEW guard", () => {
  it("blocks scheduledAt changes on PENDING_REVIEW posts", async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await PATCH(
      makePatchRequest("p1", { scheduledAt: futureDate }),
      makeParams("p1")
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("review");
  });

  it("blocks scheduledAt: null on PENDING_REVIEW posts (would → DRAFT)", async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    const res = await PATCH(
      makePatchRequest("p1", { scheduledAt: null }),
      makeParams("p1")
    );
    expect(res.status).toBe(400);
  });

  it("allows content-only edits on PENDING_REVIEW posts", async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    prismaMock.post.update.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW", content: "edited" } as never);
    const res = await PATCH(
      makePatchRequest("p1", { content: "edited caption" }),
      makeParams("p1")
    );
    expect(res.status).toBe(200);
  });

  it("returns post status in response body", async () => {
    prismaMock.post.findFirst.mockResolvedValue({ id: "p1", status: "PENDING_REVIEW" } as never);
    prismaMock.post.update.mockResolvedValue({
      id: "p1",
      status: "PENDING_REVIEW",
      content: "edited",
    } as never);
    const res = await PATCH(
      makePatchRequest("p1", { content: "edited" }),
      makeParams("p1")
    );
    const body = await res.json();
    expect(body.status).toBe("PENDING_REVIEW");
  });
});
