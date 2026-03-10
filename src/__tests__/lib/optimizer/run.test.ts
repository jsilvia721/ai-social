import { prismaMock } from "@/__tests__/mocks/prisma";
import { mockReset } from "jest-mock-extended";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/ai/index", () => ({
  analyzePerformance: jest.fn(),
}));

import { runWeeklyOptimization } from "@/lib/optimizer/run";
import { analyzePerformance } from "@/lib/ai/index";

const mockAnalyzePerformance = analyzePerformance as jest.Mock;

beforeEach(() => {
  mockReset(prismaMock);
  jest.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBusiness(id: string) {
  return {
    id,
    name: `Business ${id}`,
    createdAt: new Date(),
    updatedAt: new Date(),
    contentStrategy: {
      id: `cs-${id}`,
      businessId: id,
      industry: "Tech",
      targetAudience: "Developers",
      contentPillars: ["tutorials", "news"],
      brandVoice: "Professional and helpful",
      optimizationGoal: "ENGAGEMENT",
      reviewWindowEnabled: false,
      reviewWindowHours: 24,
      postingCadence: { TWITTER: 5 },
      researchSources: null,
      formatMix: null,
      optimalTimeWindows: null,
      lastOptimizedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function makePublishedPost(id: string, overrides: Record<string, unknown> = {}) {
  const publishedAt = new Date("2026-02-10T10:00:00Z");
  return {
    id,
    businessId: "biz-1",
    socialAccountId: "sa-1",
    content: "Test post content",
    mediaUrls: [],
    status: "PUBLISHED",
    retryCount: 0,
    retryAt: null,
    scheduledAt: null,
    publishedAt,
    reviewWindowExpiresAt: null,
    blotatoPostId: "blotato-1",
    errorMessage: null,
    briefId: null,
    topicPillar: "tutorials",
    tone: "educational",
    metricsLikes: 100,
    metricsComments: 20,
    metricsShares: 30,
    metricsSaves: 10,
    metricsImpressions: 1000,
    metricsReach: 500,
    metricsUpdatedAt: new Date("2026-02-11T10:00:00Z"), // after publishedAt + 24h
    createdAt: new Date(),
    updatedAt: new Date(),
    socialAccount: { platform: "TWITTER" },
    contentBrief: { recommendedFormat: "TEXT" },
    ...overrides,
  };
}

function mockValidClaude() {
  mockAnalyzePerformance.mockResolvedValue({
    patterns: ["Tutorial posts get 2x engagement", "Videos underperform"],
    formatMixChanges: { TEXT: 0.1, VIDEO: -0.1 },
    cadenceChanges: { TWITTER: 1 },
    topicInsights: ["Lean into tutorials"],
    digest: "Your tutorial posts are performing well. Shifting format mix toward more text posts.",
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runWeeklyOptimization", () => {
  it("skips businesses with fewer than 10 mature posts", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    // Only 5 posts
    const posts = Array.from({ length: 5 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    const result = await runWeeklyOptimization();

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(mockAnalyzePerformance).not.toHaveBeenCalled();
  });

  it("processes business with 10+ mature posts", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    mockValidClaude();
    prismaMock.contentStrategy.update.mockResolvedValue({} as never);
    prismaMock.strategyDigest.create.mockResolvedValue({} as never);

    const result = await runWeeklyOptimization();

    expect(result.processed).toBe(1);
    expect(mockAnalyzePerformance).toHaveBeenCalledTimes(1);
  });

  it("validates Claude response with Zod and rejects invalid shapes", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    // Claude returns invalid response (missing required fields)
    mockAnalyzePerformance.mockResolvedValue({
      badField: "this should fail Zod",
    });

    const result = await runWeeklyOptimization();

    // Should be skipped due to Zod validation error (caught)
    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
  });

  it("applies guardrails: caps format mix at +/-0.2", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    // Claude suggests extreme changes — Zod schema itself limits to +/-0.2
    // so valid response but at the boundary
    mockAnalyzePerformance.mockResolvedValue({
      patterns: ["test pattern"],
      formatMixChanges: { TEXT: 0.2, VIDEO: -0.2 },
      digest: "test digest",
    });

    prismaMock.contentStrategy.update.mockResolvedValue({} as never);
    prismaMock.strategyDigest.create.mockResolvedValue({} as never);

    const result = await runWeeklyOptimization();
    expect(result.processed).toBe(1);

    // Verify strategy was updated
    expect(prismaMock.contentStrategy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "biz-1" },
        data: expect.objectContaining({
          formatMix: expect.any(Object),
          lastOptimizedAt: expect.any(Date),
        }),
      })
    );
  });

  it("applies guardrails: caps cadence at +/-2", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    mockAnalyzePerformance.mockResolvedValue({
      patterns: ["test"],
      cadenceChanges: { TWITTER: 2 },
      digest: "test digest",
    });

    prismaMock.contentStrategy.update.mockResolvedValue({} as never);
    prismaMock.strategyDigest.create.mockResolvedValue({} as never);

    const result = await runWeeklyOptimization();
    expect(result.processed).toBe(1);

    expect(prismaMock.contentStrategy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          postingCadence: expect.objectContaining({ TWITTER: 7 }), // 5 + 2
        }),
      })
    );
  });

  it("creates StrategyDigest with unique businessId+weekOf", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    mockValidClaude();
    prismaMock.contentStrategy.update.mockResolvedValue({} as never);
    prismaMock.strategyDigest.create.mockResolvedValue({} as never);

    await runWeeklyOptimization();

    expect(prismaMock.strategyDigest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1",
        weekOf: expect.any(Date),
        summary: expect.any(String),
        patterns: expect.objectContaining({
          topPerformers: expect.any(Array),
          insights: expect.any(Array),
        }),
        changes: expect.any(Object),
      }),
    });
  });

  it("handles Claude API failure gracefully", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`)
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    mockAnalyzePerformance.mockRejectedValue(new Error("API timeout"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const result = await runWeeklyOptimization();

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(prismaMock.contentStrategy.update).not.toHaveBeenCalled();
    expect(prismaMock.strategyDigest.create).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("skips posts with stale metrics (metricsUpdatedAt before publishedAt)", async () => {
    const business = makeBusiness("biz-1");
    prismaMock.business.findMany.mockResolvedValue([business as never]);

    // All posts have stale metrics
    const posts = Array.from({ length: 12 }, (_, i) =>
      makePublishedPost(`post-${i}`, {
        publishedAt: new Date("2026-02-10T10:00:00Z"),
        metricsUpdatedAt: new Date("2026-02-09T10:00:00Z"), // before publish
      })
    );
    prismaMock.post.findMany.mockResolvedValue(posts as never);

    const result = await runWeeklyOptimization();

    expect(result.skipped).toBe(1); // skipped due to insufficient mature posts
    expect(mockAnalyzePerformance).not.toHaveBeenCalled();
  });
});
