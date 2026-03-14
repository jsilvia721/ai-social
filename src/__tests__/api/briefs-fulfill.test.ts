import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/briefs/[id]/fulfill/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(id: string, body: object) {
  return [
    new NextRequest(`http://localhost/api/briefs/${id}/fulfill`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

const validBody = {
  caption: "Great post about AI!",
  mediaUrls: ["https://storage.example.com/image.jpg"],
  socialAccountId: "sa-1",
};

describe("POST /api/briefs/[id]/fulfill", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when brief not found", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(null);
    const [req, ctx] = makeRequest("cb-999", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING", scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 400 when brief is not PENDING", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "FULFILLED", scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("PENDING");
  });

  it("returns 400 for invalid request body", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING", scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1", { caption: "" }); // empty caption
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 400 for unsafe media URLs", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING", scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1", {
      ...validBody,
      mediaUrls: ["https://evil.com/image.jpg"],
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid media URL");
  });

  it("returns 400 when social account platform doesn't match brief", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING", scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "sa-1", businessId: "biz-1", platform: "INSTAGRAM", // wrong platform
    } as any);

    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("does not match");
  });

  it("returns 400 when fulfilling INSTAGRAM brief without media", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
      scheduledFor: new Date(), platform: "INSTAGRAM",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "sa-1", businessId: "biz-1", platform: "INSTAGRAM",
    } as any);

    const [req, ctx] = makeRequest("cb-1", {
      caption: "No media IG post",
      mediaUrls: [],
      socialAccountId: "sa-1",
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("INSTAGRAM requires at least one image or video");
  });

  it("creates SCHEDULED post and returns 201 with nextBriefId", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
      scheduledFor: new Date("2026-03-10T10:00:00Z"), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "sa-1", businessId: "biz-1", platform: "TWITTER",
    } as any);

    const createdPost = {
      id: "post-1", businessId: "biz-1", socialAccountId: "sa-1",
      content: "Great post about AI!", status: "SCHEDULED",
    };
    prismaMock.post.create.mockResolvedValue(createdPost as any);
    prismaMock.contentBrief.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.contentBrief.findFirst.mockResolvedValue({ id: "cb-2" } as any);

    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.post.id).toBe("post-1");
    expect(body.nextBriefId).toBe("cb-2");
  });

  it("returns null nextBriefId when no more pending briefs", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      id: "cb-1", businessId: "biz-1", status: "PENDING",
      scheduledFor: new Date(), platform: "TWITTER",
    } as any);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findUnique.mockResolvedValue({
      id: "sa-1", businessId: "biz-1", platform: "TWITTER",
    } as any);

    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);
    prismaMock.contentBrief.update.mockResolvedValue({} as any);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.contentBrief.findFirst.mockResolvedValue(null);

    const [req, ctx] = makeRequest("cb-1", validBody);
    const res = await POST(req, ctx);
    const body = await res.json();
    expect(body.nextBriefId).toBeNull();
  });
});
