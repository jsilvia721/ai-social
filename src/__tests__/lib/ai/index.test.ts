jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(true),
}));
jest.mock("@/lib/system-metrics", () => ({
  trackApiCall: jest.fn(),
}));

import { generateVideoStoryboard } from "@/lib/ai/index";
import type { ContentBrief, ContentStrategy } from "@prisma/client";

// ── Test helpers ────────────────────────────────────────────────────────────────

function makeStrategy(overrides: Partial<ContentStrategy> = {}): ContentStrategy {
  return {
    id: "cs-1",
    businessId: "biz-1",
    industry: "Marketing",
    targetAudience: "Marketers aged 25-45",
    contentPillars: ["AI", "Social Media", "Growth"],
    brandVoice: "Professional and engaging",
    optimizationGoal: "ENGAGEMENT",
    reviewWindowEnabled: false,
    reviewWindowHours: 24,
    postingCadence: null,
    researchSources: null,
    formatMix: null,
    optimalTimeWindows: null,
    accountType: "BUSINESS",
    visualStyle: "clean minimalist",
    lastOptimizedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContentStrategy;
}

function makeBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: "brief-1",
    businessId: "biz-1",
    researchSummaryId: null,
    topic: "How AI is transforming marketing in 2026",
    rationale: "Trending topic in the industry",
    suggestedCaption: "AI is changing marketing forever!",
    aiImagePrompt: "A futuristic AI marketing dashboard",
    contentGuidance: null,
    recommendedFormat: "VIDEO",
    platform: "YOUTUBE",
    scheduledFor: new Date("2026-03-09T12:00:00Z"),
    status: "PENDING",
    weekOf: new Date("2026-03-08T00:00:00Z"),
    sortOrder: 0,
    retryCount: 0,
    errorMessage: null,
    videoScript: null,
    videoPrompt: null,
    storyboardImageUrl: null,
    replicatePredictionId: null,
    videoModel: null,
    videoAspectRatio: null,
    postId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContentBrief;
}

// ── generateVideoStoryboard ─────────────────────────────────────────────────

describe("generateVideoStoryboard", () => {
  it("returns structured storyboard with videoScript, videoPrompt, thumbnailPrompt", async () => {
    const brief = makeBrief();
    const strategy = makeStrategy();

    const result = await generateVideoStoryboard(brief, strategy);

    expect(result).toHaveProperty("videoScript");
    expect(result).toHaveProperty("videoPrompt");
    expect(result).toHaveProperty("thumbnailPrompt");
    expect(typeof result.videoScript).toBe("string");
    expect(typeof result.videoPrompt).toBe("string");
    expect(typeof result.thumbnailPrompt).toBe("string");
    expect(result.videoScript.length).toBeGreaterThan(0);
    expect(result.videoPrompt.length).toBeGreaterThan(0);
    expect(result.thumbnailPrompt.length).toBeGreaterThan(0);
  });

});
