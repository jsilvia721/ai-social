import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/media");
jest.mock("@/lib/storage");

import { runFulfillment, computeReviewDecision } from "@/lib/fulfillment";
import { generateImage } from "@/lib/media";
import { uploadBuffer } from "@/lib/storage";

const mockGenerateImage = generateImage as jest.MockedFunction<typeof generateImage>;
const mockUploadBuffer = uploadBuffer as jest.MockedFunction<typeof uploadBuffer>;

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
    expect(mockGenerateImage).toHaveBeenCalledWith("A futuristic marketing dashboard");
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

    expect(mockGenerateImage).toHaveBeenCalledWith("A futuristic marketing dashboard");
    expect(mockUploadBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.stringContaining("media/biz-1/brief-1"),
      "image/png"
    );
  });

  it("skips CAROUSEL/VIDEO format with warning", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
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
      expect.stringContaining("CAROUSEL format not supported")
    );
    expect(prismaMock.post.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ mediaUrls: [] }),
      })
    );
    consoleSpy.mockRestore();
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

  it("scopes to specific businessId when provided", async () => {
    prismaMock.contentBrief.findMany.mockResolvedValue([] as never);

    await runFulfillment("biz-42");

    expect(prismaMock.contentBrief.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-42" }),
      })
    );
  });
});
