import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/media", () => ({
  generateVideo: jest.fn(),
}));

import { POST } from "@/app/api/briefs/[id]/approve-storyboard/route";
import { generateVideo } from "@/lib/media";
import { NextRequest } from "next/server";

const mockGenerateVideo = generateVideo as jest.MockedFunction<typeof generateVideo>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(id: string, body?: object) {
  return [
    new NextRequest(`http://localhost/api/briefs/${id}/approve-storyboard`, {
      method: "POST",
      body: body ? JSON.stringify(body) : "{}",
      headers: { "Content-Type": "application/json" },
    }),
    { params: Promise.resolve({ id }) },
  ] as const;
}

const storyboardBrief = {
  id: "cb-1",
  businessId: "biz-1",
  status: "STORYBOARD_REVIEW",
  platform: "TIKTOK",
  videoPrompt: "Original AI-generated video prompt",
} as any;

describe("POST /api/briefs/[id]/approve-storyboard", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when brief not found", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(null);
    const [req, ctx] = makeRequest("cb-999");
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 409 when brief is not in STORYBOARD_REVIEW", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      ...storyboardBrief,
      status: "PENDING",
    });
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("STORYBOARD_REVIEW");
  });

  it("triggers video generation and returns 200 with predictionId", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    mockGenerateVideo.mockResolvedValue({ predictionId: "pred-123" });
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.predictionId).toBe("pred-123");

    // Verify generateVideo was called with correct params
    expect(mockGenerateVideo).toHaveBeenCalledWith({
      prompt: "Original AI-generated video prompt",
      aspectRatio: "9:16", // TikTok = 9:16
      webhookUrl: expect.stringContaining("/api/webhooks/replicate"),
      duration: 5,
    });

    // Verify atomic conditional update
    expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledWith({
      where: { id: "cb-1", status: "STORYBOARD_REVIEW" },
      data: {
        replicatePredictionId: "pred-123",
        videoModel: "kwaivgi/kling-v3-omni-video",
        videoAspectRatio: "9:16",
        status: "RENDERING",
      },
    });
  });

  it("uses edited videoPrompt from request body when provided", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    mockGenerateVideo.mockResolvedValue({ predictionId: "pred-456" });
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });

    const [req, ctx] = makeRequest("cb-1", { videoPrompt: "My custom edited prompt" });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGenerateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "My custom edited prompt" })
    );
  });

  it("returns 400 when no video prompt is available", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue({
      ...storyboardBrief,
      videoPrompt: null,
    });
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);

    const [req, ctx] = makeRequest("cb-1", {});
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("No video prompt");
  });

  it("returns 502 when generateVideo fails", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    mockGenerateVideo.mockRejectedValue(new Error("Replicate API timeout"));

    const [req, ctx] = makeRequest("cb-1");
    const res = await POST(req, ctx);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Video generation failed");
    expect(body.detail).toContain("Replicate API timeout");
  });

  it("returns 409 when concurrent approval races — only first wins", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    mockGenerateVideo.mockResolvedValue({ predictionId: "pred-race" });

    // First call wins the atomic update, second gets count: 0
    prismaMock.contentBrief.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [req1, ctx1] = makeRequest("cb-1");
    const [req2, ctx2] = makeRequest("cb-1");
    const [res1, res2] = await Promise.all([POST(req1, ctx1), POST(req2, ctx2)]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Only one generateVideo call should proceed to update
    // (both may call generateVideo since the guard is at update time,
    // but only one should succeed the atomic transition)
    const successRes = res1.status === 200 ? res1 : res2;
    const body = await successRes.json();
    expect(body.predictionId).toBe("pred-race");
  });

  it("falls back to brief videoPrompt when body videoPrompt is not provided", async () => {
    mockAuthenticated();
    prismaMock.contentBrief.findUnique.mockResolvedValue(storyboardBrief);
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    mockGenerateVideo.mockResolvedValue({ predictionId: "pred-789" });
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });

    const [req, ctx] = makeRequest("cb-1", {});
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);

    expect(mockGenerateVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Original AI-generated video prompt" })
    );
  });
});
