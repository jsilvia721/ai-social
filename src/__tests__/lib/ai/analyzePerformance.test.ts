/**
 * Tests for analyzePerformance with platform intelligence enrichment.
 */

jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));
jest.mock("@/lib/system-metrics", () => ({
  trackApiCall: jest.fn(),
}));

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: class {
    messages = { create: (...args: unknown[]) => mockCreate(...args) };
  },
}));

import { analyzePerformance } from "@/lib/ai/index";

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultInput = {
  posts: [
    {
      id: "post-1",
      platform: "TWITTER" as const,
      format: "TEXT",
      topicPillar: "AI",
      tone: "educational",
      engagementRate: 5.2,
      metricsLikes: 100,
      metricsComments: 20,
      metricsShares: 50,
      metricsSaves: 10,
    },
    {
      id: "post-2",
      platform: "INSTAGRAM" as const,
      format: "IMAGE",
      topicPillar: "Growth",
      tone: "inspirational",
      engagementRate: 8.1,
      metricsLikes: 200,
      metricsComments: 30,
      metricsShares: 15,
      metricsSaves: 80,
    },
  ],
  strategy: {
    industry: "Marketing",
    targetAudience: "Marketers aged 25-45",
    contentPillars: ["AI", "Social Media", "Growth"],
    brandVoice: "Professional and engaging",
  },
  currentFormatMix: { TEXT: 0.4, IMAGE: 0.3, VIDEO: 0.3 },
};

function makeMockStrategyResponse() {
  return {
    content: [
      {
        type: "tool_use",
        name: "update_strategy",
        input: {
          patterns: [
            "Instagram saves are 4x higher than other platforms",
            "Twitter shares drive most reach",
          ],
          digest: "Performance analysis shows strong engagement on Instagram.",
          hookTypeRecommendations: ["Pattern Interrupt", "Authority Builder"],
        },
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("analyzePerformance", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockCreate.mockResolvedValue(makeMockStrategyResponse());
  });

  it("includes platform engagement weight context in prompt", async () => {
    await analyzePerformance(defaultInput);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    // Should include platform-specific weight context
    expect(userMsg).toContain("Platform Engagement Signal Weights");
    expect(userMsg).toContain("TWITTER");
    expect(userMsg).toContain("reposts");
    expect(userMsg).toContain("INSTAGRAM");
    expect(userMsg).toContain("saves");
  });

  it("includes hook type recommendations field in tool schema", async () => {
    await analyzePerformance(defaultInput);

    const callArgs = mockCreate.mock.calls[0][0];
    const tool = callArgs.tools[0];
    const properties = tool.input_schema.properties;

    expect(properties).toHaveProperty("hookTypeRecommendations");
    expect(properties.hookTypeRecommendations.type).toBe("array");
  });

  it("instructs Claude to analyze content structures per platform", async () => {
    await analyzePerformance(defaultInput);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    expect(userMsg).toContain("content structures");
    expect(userMsg).toContain("hook");
  });

  it("returns hookTypeRecommendations from the response", async () => {
    const result = await analyzePerformance(defaultInput);

    expect(result.hookTypeRecommendations).toEqual([
      "Pattern Interrupt",
      "Authority Builder",
    ]);
  });

  it("includes only platforms present in the post data", async () => {
    const twitterOnlyInput = {
      ...defaultInput,
      posts: [defaultInput.posts[0]], // Only Twitter posts
    };

    await analyzePerformance(twitterOnlyInput);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    expect(userMsg).toContain("TWITTER");
    // Instagram context should not be included when no Instagram posts
    expect(userMsg).not.toContain("INSTAGRAM Intelligence");
  });
});
