import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/posts/bulk-schedule/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/posts/bulk-schedule", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/posts/bulk-schedule", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest({ postIds: ["p1"], scheduledAt: "2026-03-10T10:00:00Z" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing postIds", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ scheduledAt: "2026-03-10T10:00:00Z" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for empty postIds array", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ postIds: [], scheduledAt: "2026-03-10T10:00:00Z" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing scheduledAt", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ postIds: ["p1"] }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when post not found or not authorized", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([{ id: "p1" }] as any);

    const res = await POST(makeRequest({
      postIds: ["p1", "p2"],
      scheduledAt: "2026-03-10T10:00:00Z",
    }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when any post lacks required media for its platform", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([
      { id: "p1", mediaUrls: ["https://storage.example.com/img.jpg"], socialAccount: { platform: "INSTAGRAM" } },
      { id: "p2", mediaUrls: [], socialAccount: { platform: "INSTAGRAM" } },
    ] as any);

    const res = await POST(makeRequest({
      postIds: ["p1", "p2"],
      scheduledAt: "2026-03-10T10:00:00Z",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("media");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("allows bulk-scheduling posts on platforms that don't require media", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([
      { id: "p1", mediaUrls: [], socialAccount: { platform: "TWITTER" } },
      { id: "p2", mediaUrls: [], socialAccount: { platform: "FACEBOOK" } },
    ] as any);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any);

    const res = await POST(makeRequest({
      postIds: ["p1", "p2"],
      scheduledAt: "2026-03-10T10:00:00Z",
    }));
    expect(res.status).toBe(200);
  });

  it("schedules all posts and returns 200", async () => {
    mockAuthenticated();
    prismaMock.post.findMany.mockResolvedValue([
      { id: "p1" }, { id: "p2" },
    ] as any);
    prismaMock.$transaction.mockResolvedValue([{}, {}] as any);

    const res = await POST(makeRequest({
      postIds: ["p1", "p2"],
      scheduledAt: "2026-03-10T10:00:00Z",
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scheduled).toBe(2);
  });
});
