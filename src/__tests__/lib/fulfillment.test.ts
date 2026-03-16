import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/media");
jest.mock("@/lib/storage");
jest.mock("@/lib/alerts");
jest.mock("@/lib/ai/index");
jest.mock("@/lib/video");

const mockReplicateGet = jest.fn();
jest.mock("@/lib/replicate-client", () => ({
  getReplicateClient: () => ({ predictions: { get: mockReplicateGet } }),
}));

import { runFulfillment, computeReviewDecision, reconcileStuckRendering } from "@/lib/fulfillment";
import { generateImage } from "@/lib/media";
import { uploadBuffer } from "@/lib/storage";
import { sendFailureAlert } from "@/lib/alerts";
import { generateVideoStoryboard } from "@/lib/ai/index";
import { processCompletedPrediction } from "@/lib/video";

const mockGenerateImage = generateImage as jest.MockedFunction<typeof generateImage>;
const mockUploadBuffer = uploadBuffer as jest.MockedFunction<typeof uploadBuffer>;
const mockSendFailureAlert = sendFailureAlert as jest.MockedFunction<typeof sendFailureAlert>;
const mockGenerateVideoStoryboard = generateVideoStoryboard as jest.MockedFunction<typeof generateVideoStoryboard>;
const mockProcessCompletedPrediction = processCompletedPrediction as jest.MockedFunction<typeof processCompletedPrediction>;

// ── Test helpers ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-03-08T12:00:00Z");

function makeBrief(overrides: Record<string, unknown> = {}) {
  return {
    id: "brief-1",
    businessId: "biz-1",
    researchSummaryId: null,
    topic: "AI in marketing",
    rationale: "Trending topic",
    suggestedCaption: "AI is changing marketing forever!",
    aiImagePrompt: "A futuristic marketing dashboard",
    contentGuidance: null,
    recommendedFormat: "IMAGE" as const,
    platform: "TWITTER" as const,
    scheduledFor: new Date("2026-03-09T12:00:00Z"), // 24h from NOW
    status: "PENDING" as const,
    weekOf: new Date("2026-03-08T00:00:00Z"),
    sortOrder: 0,
    retryCount: 0,
    errorMessage: null,
    postId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    business: {
      contentStrategy: {
        id: "cs-1",
        businessId: "biz-1",
        industry: "Marketing",
        targetAudience: "Marketers",
        contentPillars: ["AI", "Social Media"],
        brandVoice: "Professional",
        optimizationGoal: "ENGAGEMENT",
        reviewWindowEnabled: false,
        reviewWindowHours: 24,
        postingCadence: null,
        researchSources: null,
        formatMix: null,
        optimalTimeWindows: null,
        accountType: "BUSINESS",
        visualStyle: null,
        lastOptimizedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      socialAccounts: [
        {
          id: "sa-1",
          businessId: "biz-1",
          platform: "TWITTER" as const,
          platformId: "tw-123",
          username: "@acme",
          blotatoAccountId: "blotato-1",
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    ...overrides,
  };
}

// ── Setup ───────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });

  mockGenerateImage.mockResolvedValue({
    buffer: Buffer.from("fake-image"),
    mimeType: "image/png",
  });
  mockUploadBuffer.mockResolvedValue("https://cdn.example.com/media/biz-1/brief-1.png");

  // Default: no stuck briefs to recover
  prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });

  mockGenerateVideoStoryboard.mockResolvedValue({
    videoScript: "Scene 1: Open on a wide shot...",
    videoPrompt: "A cinematic video about AI in marketing",
    thumbnailPrompt: "Eye-catching thumbnail of AI dashboard",
  });
});

afterEach(() => {
  jest.useRealTimers();
});

// ── computeReviewDecision ───────────────────────────────────────────────────────

describe("computeReviewDecision", () => {
  it("returns PENDING_REVIEW with null expiresAt when reviewWindowEnabled is false", () => {
    const result = computeReviewDecision(false, 24, new Date("2026-03-10T12:00:00Z"), NOW);
    expect(result).toEqual({ status: "PENDING_REVIEW", reviewWindowExpiresAt: null });
  });

  it("returns PENDING_REVIEW with expiresAt when reviewWindowEnabled is true", () => {
    const result = computeReviewDecision(true, 24, new Date("2026-03-10T12:00:00Z"), NOW);
    expect(result).toEqual({
      status: "PENDING_REVIEW",
      reviewWindowExpiresAt: new Date("2026-03-09T12:00:00Z"),
    });
  });

  it("returns SCHEDULED when insufficient time for review window", () => {
    // scheduledFor is 3h from now, reviewWindowHours is 24
    const result = computeReviewDecision(true, 24, new Date("2026-03-08T15:00:00Z"), NOW);
    expect(result).toEqual({ status: "SCHEDULED", reason: "insufficient_review_time" });
  });

  it("returns SCHEDULED when less than 2 hours until scheduled (explicit mode)", () => {
    const result = computeReviewDecision(false, 24, new Date("2026-03-08T13:30:00Z"), NOW);
    expect(result).toEqual({ status: "SCHEDULED", reason: "insufficient_review_time" });
  });

  it("allows review when exactly enough time for review window", () => {
    // scheduledFor is 24h from now, reviewWindowHours is 24
    const result = computeReviewDecision(true, 24, new Date("2026-03-09T12:00:00Z"), NOW);
    expect(result).toEqual({
      status: "PENDING_REVIEW",
      reviewWindowExpiresAt: new Date("2026-03-09T12:00:00Z"),
    });
  });

  it("returns SCHEDULED with no_review_configured when hours is 0 (immediate mode)", () => {
    const result = computeReviewDecision(true, 0, new Date("2026-03-10T12:00:00Z"), NOW);
    expect(result).toEqual({ status: "SCHEDULED", reason: "no_review_configured" });
  });
});

// ── runFulfillment ──────────────────────────────────────────────────────────────

describe("runFulfillment", () => {
  it("fulfills PENDING briefs within 48h window", async () => {
    const brief = makeBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.processed).toBe(1);
    expect(result.created).toBe(1);
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("A futuristic marketing dashboard")
    );
    expect(mockUploadBuffer).toHaveBeenCalled();
  });

  it("resolves socialAccountId for brief platform", async () => {
    const brief = makeBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ socialAccountId: "sa-1" }),
      })
    );
  });

  it("skips briefs with no connected account for platform", async () => {
    const brief = makeBrief({
      platform: "INSTAGRAM",
      // business only has TWITTER account
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);

    const result = await runFulfillment();

    expect(result.skipped).toBe(1);
    expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledTimes(1); // only recover call
  });

  it("uses atomic claim to prevent double-processing", async () => {
    const brief = makeBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    // Claim fails — another invocation got it
    prismaMock.contentBrief.updateMany
      .mockResolvedValueOnce({ count: 0 }) // recover stuck
      .mockResolvedValueOnce({ count: 0 }); // claim fails

    const result = await runFulfillment();

    expect(result.skipped).toBe(1);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it("skips if Post with briefId already exists (idempotency)", async () => {
    const brief = makeBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue({ id: "existing-post" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.skipped).toBe(1);
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "brief-1" },
        data: expect.objectContaining({ status: "FULFILLED", postId: "existing-post" }),
      })
    );
  });

  it("sets correct status based on computeReviewDecision (explicit mode)", async () => {
    const brief = makeBrief(); // reviewWindowEnabled: false → PENDING_REVIEW, null
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_REVIEW",
          reviewWindowExpiresAt: null,
        }),
      })
    );
  });

  it("skips review when insufficient time before scheduledFor", async () => {
    const brief = makeBrief({
      scheduledFor: new Date("2026-03-08T13:00:00Z"), // 1h from NOW — too close
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SCHEDULED" }),
      })
    );
  });

  it("handles media generation failure with retry", async () => {
    const brief = makeBrief({ retryCount: 0 });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    mockGenerateImage.mockRejectedValue(new Error("Provider timeout"));
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.failed).toBe(1);
    // Should revert to PENDING with incremented retryCount
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          retryCount: 1,
          errorMessage: "Provider timeout",
        }),
      })
    );
  });

  it("marks FAILED after max retries", async () => {
    const brief = makeBrief({ retryCount: 2 }); // Already at max
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    mockGenerateImage.mockRejectedValue(new Error("Provider timeout"));
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.failed).toBe(1);
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          retryCount: 3,
        }),
      })
    );
  });

  it("sends SES failure alert to business owner after max retries", async () => {
    const brief = makeBrief({ retryCount: 2 }); // Already at max
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    mockGenerateImage.mockRejectedValue(new Error("Provider timeout"));
    prismaMock.contentBrief.update.mockResolvedValue({} as never);
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: "user-1",
      role: "OWNER",
      joinedAt: new Date(),
      user: { id: "user-1", email: "owner@example.com", name: "Owner", emailVerified: null, image: null, isAdmin: false, activeBusinessId: "biz-1", createdAt: new Date(), updatedAt: new Date() },
    } as never);
    mockSendFailureAlert.mockResolvedValue(undefined);

    await runFulfillment();

    expect(mockSendFailureAlert).toHaveBeenCalledWith(
      "owner@example.com",
      expect.stringContaining("Content brief failed"),
      expect.stringContaining("AI in marketing"),
    );
  });

  it("does not send alert when brief fails but retries remain", async () => {
    const brief = makeBrief({ retryCount: 0 });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    mockGenerateImage.mockRejectedValue(new Error("Provider timeout"));
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(mockSendFailureAlert).not.toHaveBeenCalled();
  });

  it("creates text-only post for TEXT format (no media)", async () => {
    const brief = makeBrief({ recommendedFormat: "TEXT", aiImagePrompt: null });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(mockGenerateImage).not.toHaveBeenCalled();
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaUrls: [] }),
      })
    );
  });

  it("generates and uploads media for IMAGE format", async () => {
    const brief = makeBrief({ recommendedFormat: "IMAGE" });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("A futuristic marketing dashboard")
    );
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringContaining("media/biz-1/brief-1"),
      "image/png"
    );
  });

  it("generates single image as fallback for CAROUSEL format", async () => {
    const consoleSpy = jest.spyOn(console, "info").mockImplementation();
    const brief = makeBrief({ recommendedFormat: "CAROUSEL" });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("CAROUSEL fallback")
    );
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("A futuristic marketing dashboard")
    );
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringContaining("media/biz-1/brief-1"),
      "image/png"
    );
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaUrls: [expect.stringContaining("media/biz-1/brief-1")],
        }),
      })
    );
    consoleSpy.mockRestore();
  });

  it("creates post with media for CAROUSEL format on INSTAGRAM", async () => {
    const brief = makeBrief({
      recommendedFormat: "CAROUSEL",
      platform: "INSTAGRAM",
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [
          {
            id: "sa-ig",
            businessId: "biz-1",
            platform: "INSTAGRAM" as const,
            platformId: "ig-123",
            username: "@acme_ig",
            blotatoAccountId: "blotato-ig",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-ig-carousel" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.created).toBe(1);
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("A futuristic marketing dashboard")
    );
    expect(mockUploadBuffer).toHaveBeenCalled();
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          socialAccountId: "sa-ig",
          mediaUrls: ["https://cdn.example.com/media/biz-1/brief-1.png"],
        }),
      })
    );
  });

  it("recovers stuck FULFILLING briefs (preserves retryCount)", async () => {
    prismaMock.contentBrief.findMany.mockResolvedValue([] as never);

    await runFulfillment();

    expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "FULFILLING",
          updatedAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: { status: "PENDING" },
      })
    );
  });

  it("sets both Post.briefId and ContentBrief.postId in same transaction", async () => {
    const brief = makeBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    // Verify $transaction was called with a function (interactive transaction)
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function));
    // Verify post.create sets briefId
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ briefId: "brief-1" }),
      })
    );
    // Verify contentBrief.update sets postId
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ postId: "post-1" }),
      })
    );
  });

  it("fails INSTAGRAM brief when media generation returns null (TEXT format)", async () => {
    const brief = makeBrief({
      platform: "INSTAGRAM",
      recommendedFormat: "TEXT",
      aiImagePrompt: null,
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [
          {
            id: "sa-ig",
            businessId: "biz-1",
            platform: "INSTAGRAM" as const,
            platformId: "ig-123",
            username: "@acme_ig",
            blotatoAccountId: "blotato-ig",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.failed).toBe(1);
    expect(prismaMock.post.create).not.toHaveBeenCalled();
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("INSTAGRAM requires media"),
        }),
      })
    );
  });

  it("creates post normally for INSTAGRAM brief with IMAGE format", async () => {
    const brief = makeBrief({
      platform: "INSTAGRAM",
      recommendedFormat: "IMAGE",
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [
          {
            id: "sa-ig",
            businessId: "biz-1",
            platform: "INSTAGRAM" as const,
            platformId: "ig-123",
            username: "@acme_ig",
            blotatoAccountId: "blotato-ig",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-ig" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.created).toBe(1);
    expect(mockGenerateImage).toHaveBeenCalled();
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mediaUrls: ["https://cdn.example.com/media/biz-1/brief-1.png"],
        }),
      })
    );
  });

  it("creates post without media for TWITTER brief with TEXT format (no regression)", async () => {
    const brief = makeBrief({ recommendedFormat: "TEXT", aiImagePrompt: null });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    expect(result.created).toBe(1);
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaUrls: [] }),
      })
    );
  });

  it("scopes to specific businessId when provided", async () => {
    prismaMock.contentBrief.findMany.mockResolvedValue([] as never);

    await runFulfillment("biz-42");

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-42" }),
      })
    );
  });

  // ── VIDEO storyboard generation ─────────────────────────────────────────────

  it("generates storyboard for VIDEO brief and transitions to STORYBOARD_REVIEW", async () => {
    const brief = makeBrief({
      recommendedFormat: "VIDEO",
      platform: "YOUTUBE",
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [
          {
            id: "sa-yt",
            businessId: "biz-1",
            platform: "YOUTUBE" as const,
            platformId: "yt-123",
            username: "@acme_yt",
            blotatoAccountId: "blotato-yt",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await runFulfillment();

    // Should call generateVideoStoryboard
    expect(mockGenerateVideoStoryboard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brief-1" }),
      expect.objectContaining({ id: "cs-1" })
    );
    // Should generate thumbnail via generateImage
    expect(mockGenerateImage).toHaveBeenCalledWith(
      expect.stringContaining("Eye-catching thumbnail")
    );
    // Should upload thumbnail with extension matching mime type
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      "media/biz-1/brief-1-thumb.png",
      "image/png"
    );
    // Should update brief with storyboard data and STORYBOARD_REVIEW status
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "brief-1" },
        data: expect.objectContaining({
          status: "STORYBOARD_REVIEW",
          videoScript: "Scene 1: Open on a wide shot...",
          videoPrompt: "A cinematic video about AI in marketing",
          storyboardImageUrl: "https://cdn.example.com/media/biz-1/brief-1.png",
        }),
      })
    );
    // Should NOT create a Post
    expect(prismaMock.post.create).not.toHaveBeenCalled();
    // Counts as "created" (successfully processed)
    expect(result.created).toBe(1);
  });

  it("skips Post creation when brief status is STORYBOARD_REVIEW after handler", async () => {
    const brief = makeBrief({
      recommendedFormat: "VIDEO",
      platform: "TWITTER",
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    await runFulfillment();

    expect(prismaMock.post.create).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("retries VIDEO storyboard generation on failure", async () => {
    const brief = makeBrief({
      recommendedFormat: "VIDEO",
      platform: "YOUTUBE",
      retryCount: 0,
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [
          {
            id: "sa-yt",
            businessId: "biz-1",
            platform: "YOUTUBE" as const,
            platformId: "yt-123",
            username: "@acme_yt",
            blotatoAccountId: "blotato-yt",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);
    mockGenerateVideoStoryboard.mockRejectedValue(new Error("AI timeout"));

    const result = await runFulfillment();

    expect(result.failed).toBe(1);
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING",
          retryCount: 1,
          errorMessage: "AI timeout",
        }),
      })
    );
  });

  it("stuck brief recovery excludes STORYBOARD_REVIEW and RENDERING", async () => {
    prismaMock.contentBrief.findMany.mockResolvedValue([] as never);

    await runFulfillment();

    // The recovery query should only target FULFILLING status
    const recoveryCall = prismaMock.contentBrief.updateMany.mock.calls[0];
    expect(recoveryCall[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "FULFILLING",
        }),
      })
    );
    // Verify it does NOT include STORYBOARD_REVIEW or RENDERING in the query
    const whereClause = recoveryCall[0]?.where;
    expect(whereClause?.status).toBe("FULFILLING");
  });
});

// ── reconcileStuckRendering ──────────────────────────────────────────────────

describe("reconcileStuckRendering", () => {
  function makeRenderingBrief(overrides: Record<string, unknown> = {}) {
    return {
      id: "brief-render-1",
      businessId: "biz-1",
      researchSummaryId: null,
      topic: "Video about AI",
      rationale: "Trending",
      suggestedCaption: "Watch this AI video!",
      aiImagePrompt: null,
      contentGuidance: null,
      recommendedFormat: "VIDEO" as const,
      platform: "YOUTUBE" as const,
      scheduledFor: new Date("2026-03-09T12:00:00Z"),
      status: "RENDERING" as const,
      weekOf: new Date("2026-03-08T00:00:00Z"),
      sortOrder: 0,
      retryCount: 0,
      errorMessage: null,
      postId: null,
      videoScript: "Scene 1: ...",
      videoPrompt: "A cinematic video",
      storyboardImageUrl: "https://cdn.example.com/thumb.png",
      replicatePredictionId: "pred-123",
      createdAt: new Date(),
      updatedAt: new Date("2026-03-08T11:30:00Z"), // 30 min ago from NOW
      business: {
        contentStrategy: {
          id: "cs-1",
          businessId: "biz-1",
          industry: "Marketing",
          targetAudience: "Marketers",
          contentPillars: ["AI"],
          brandVoice: "Professional",
          optimizationGoal: "ENGAGEMENT",
          reviewWindowEnabled: false,
          reviewWindowHours: 24,
          postingCadence: null,
          researchSources: null,
          formatMix: null,
          optimalTimeWindows: null,
          accountType: "BUSINESS",
          visualStyle: null,
          lastOptimizedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        socialAccounts: [
          {
            id: "sa-yt",
            businessId: "biz-1",
            platform: "YOUTUBE" as const,
            platformId: "yt-123",
            username: "@acme_yt",
            blotatoAccountId: "blotato-yt",
            accessToken: null,
            refreshToken: null,
            expiresAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    mockReplicateGet.mockReset();
    mockProcessCompletedPrediction.mockReset();
  });

  it("queries RENDERING briefs older than 15 minutes", async () => {
    prismaMock.contentBrief.findMany.mockResolvedValue([]);

    await reconcileStuckRendering();

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RENDERING",
          updatedAt: { lt: expect.any(Date) },
        }),
      })
    );

    // Verify the threshold is ~15 minutes ago
    const call = prismaMock.contentBrief.findMany.mock.calls[0][0] as {
      where: { updatedAt: { lt: Date } };
    };
    const threshold = call.where.updatedAt.lt;
    const expectedThreshold = new Date(NOW.getTime() - 15 * 60 * 1000);
    expect(threshold.getTime()).toBe(expectedThreshold.getTime());
  });

  it("calls processCompletedPrediction for succeeded predictions", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "succeeded",
      output: "https://replicate.delivery/video.mp4",
    });
    mockProcessCompletedPrediction.mockResolvedValue({
      outcome: "created",
      postId: "post-1",
    });

    const result = await reconcileStuckRendering();

    expect(mockReplicateGet).toHaveBeenCalledWith("pred-123");
    // Atomic claim: RENDERING → FULFILLING
    expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledWith({
      where: { id: "brief-render-1", status: "RENDERING" },
      data: { status: "FULFILLING" },
    });
    expect(mockProcessCompletedPrediction).toHaveBeenCalledWith(
      brief,
      "https://replicate.delivery/video.mp4"
    );
    expect(result).toEqual({ reconciled: 1, failed: 0, skipped: 0 });
  });

  it("skips succeeded prediction if already claimed by webhook", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 }); // claim fails
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "succeeded",
      output: "https://replicate.delivery/video.mp4",
    });

    const result = await reconcileStuckRendering();

    expect(mockProcessCompletedPrediction).not.toHaveBeenCalled();
    expect(result).toEqual({ reconciled: 0, failed: 0, skipped: 1 });
  });

  it("counts as failed when processCompletedPrediction returns failed", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "succeeded",
      output: "https://replicate.delivery/video.mp4",
    });
    mockProcessCompletedPrediction.mockResolvedValue({
      outcome: "failed",
      error: "Download failed",
    });

    const result = await reconcileStuckRendering();

    expect(result).toEqual({ reconciled: 0, failed: 1, skipped: 0 });
  });

  it("handles array output from succeeded predictions", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 });
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "succeeded",
      output: ["https://replicate.delivery/video.mp4"],
    });
    mockProcessCompletedPrediction.mockResolvedValue({
      outcome: "created",
      postId: "post-1",
    });

    await reconcileStuckRendering();

    expect(mockProcessCompletedPrediction).toHaveBeenCalledWith(
      brief,
      "https://replicate.delivery/video.mp4"
    );
  });

  it("marks FAILED for failed predictions", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "failed",
      error: "GPU out of memory",
    });
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await reconcileStuckRendering();

    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "brief-render-1" },
      data: {
        status: "FAILED",
        errorMessage: "GPU out of memory",
      },
    });
    expect(mockProcessCompletedPrediction).not.toHaveBeenCalled();
    expect(result).toEqual({ reconciled: 0, failed: 1, skipped: 0 });
  });

  it("marks FAILED for canceled predictions", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "canceled",
      error: null,
    });
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await reconcileStuckRendering();

    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "brief-render-1" },
      data: {
        status: "FAILED",
        errorMessage: "Prediction canceled",
      },
    });
    expect(result).toEqual({ reconciled: 0, failed: 1, skipped: 0 });
  });

  it("leaves still-processing predictions alone", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "processing",
    });

    const result = await reconcileStuckRendering();

    expect(prismaMock.contentBrief.update).not.toHaveBeenCalled();
    expect(mockProcessCompletedPrediction).not.toHaveBeenCalled();
    expect(result).toEqual({ reconciled: 0, failed: 0, skipped: 1 });
  });

  it("leaves starting predictions alone", async () => {
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "starting",
    });

    const result = await reconcileStuckRendering();

    expect(prismaMock.contentBrief.update).not.toHaveBeenCalled();
    expect(mockProcessCompletedPrediction).not.toHaveBeenCalled();
    expect(result).toEqual({ reconciled: 0, failed: 0, skipped: 1 });
  });

  it("skips briefs without replicatePredictionId", async () => {
    const brief = makeRenderingBrief({ replicatePredictionId: null });
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    prismaMock.contentBrief.update.mockResolvedValue({} as never);

    const result = await reconcileStuckRendering();

    expect(mockReplicateGet).not.toHaveBeenCalled();
    // Should mark as FAILED since we can't poll without a prediction ID
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "brief-render-1" },
      data: {
        status: "FAILED",
        errorMessage: "No Replicate prediction ID — cannot reconcile",
      },
    });
    expect(result).toEqual({ reconciled: 0, failed: 1, skipped: 0 });
  });

  it("handles Replicate API errors gracefully", async () => {
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockRejectedValue(new Error("API rate limit"));

    const result = await reconcileStuckRendering();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("reconcile"),
      expect.any(Error)
    );
    expect(result).toEqual({ reconciled: 0, failed: 0, skipped: 1 });
    consoleSpy.mockRestore();
  });

  it("logs warning for unknown prediction status", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
    const brief = makeRenderingBrief();
    prismaMock.contentBrief.findMany.mockResolvedValue([brief] as never);
    mockReplicateGet.mockResolvedValue({
      id: "pred-123",
      status: "queued", // unknown status
    });

    const result = await reconcileStuckRendering();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Unknown prediction status"),
      expect.objectContaining({
        status: "queued",
        predictionId: "pred-123",
        briefId: "brief-render-1",
      })
    );
    expect(result).toEqual({ reconciled: 0, failed: 0, skipped: 1 });
    consoleSpy.mockRestore();
  });
});
