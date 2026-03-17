/**
 * Tests for brief generation with hook frameworks and platform intelligence integration.
 *
 * These tests verify that the enriched prompts include hook and platform intelligence
 * sections without calling the real Anthropic API.
 */

jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(true),
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

import { generateBriefs, type GeneratedBrief } from "@/lib/ai/briefs";
import { HOOK_FRAMEWORKS } from "@/lib/ai/knowledge/hooks";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockedShouldMock = jest.mocked(shouldMockExternalApis);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockResponse(briefs: GeneratedBrief[]) {
  return {
    content: [
      {
        type: "tool_use",
        name: "generate_content_briefs",
        input: { briefs },
      },
    ],
  };
}

const sampleBrief: GeneratedBrief = {
  topic: "AI Marketing Tips",
  rationale: "Trending in the industry",
  suggestedCaption: "Stop scrolling. Here are 5 AI tips that changed our marketing game.",
  recommendedFormat: "TEXT",
  platform: "TWITTER",
  suggestedDay: "MONDAY 10:00",
  hookType: "Pattern Interrupt",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generateBriefs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // When mock is disabled (shouldMockExternalApis returns false), we need the API mock
    mockedShouldMock.mockReturnValue(false);
    mockCreate.mockResolvedValue(makeMockResponse([sampleBrief]));
  });

  it("includes hook framework instructions in the system prompt", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers aged 25-45",
      ["AI", "Growth"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 3 },
      "AI trends in 2026",
      [],
      null,
      { accountType: "BUSINESS" },
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Should include hook framework section
    expect(systemPrompt).toContain("Hook Frameworks");
    expect(systemPrompt).toContain("Pattern Interrupt");
    expect(systemPrompt).toContain("Authority Builder");
    expect(systemPrompt).toContain("Diversity Rules");
    expect(systemPrompt).toContain("at least 3 different hook types");
  });

  it("includes platform intelligence in the system prompt", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers aged 25-45",
      ["AI", "Growth"],
      "Professional",
      ["TWITTER", "INSTAGRAM"],
      { TWITTER: 3, INSTAGRAM: 2 },
      "AI trends in 2026",
      [],
      null,
      { accountType: "BUSINESS" },
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Should include platform intelligence for connected platforms
    expect(systemPrompt).toContain("TWITTER Intelligence");
    expect(systemPrompt).toContain("INSTAGRAM Intelligence");
    expect(systemPrompt).toContain("Algorithm Signals");
    expect(systemPrompt).toContain("Character Limits");
  });

  it("includes cross-platform guidelines when multiple platforms connected", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers aged 25-45",
      ["AI", "Growth"],
      "Professional",
      ["TWITTER", "INSTAGRAM"],
      { TWITTER: 3, INSTAGRAM: 2 },
      "AI trends",
      [],
      null,
      { accountType: "BUSINESS" },
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    expect(systemPrompt).toContain("Cross-Platform Content Guidelines");
  });

  it("does NOT include cross-platform guidelines for single platform", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers aged 25-45",
      ["AI", "Growth"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 3 },
      "AI trends",
      [],
      null,
      { accountType: "BUSINESS" },
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    expect(systemPrompt).not.toContain("Cross-Platform Content Guidelines");
  });

  it("includes hookType in the tool schema", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers aged 25-45",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 2 },
      "AI trends",
      [],
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const tool = callArgs.tools[0];
    const briefProperties = tool.input_schema.properties.briefs.items.properties;

    expect(briefProperties).toHaveProperty("hookType");
    expect(briefProperties.hookType.type).toBe("string");
    expect(briefProperties.hookType.enum).toEqual(
      expect.arrayContaining(["Pattern Interrupt", "Authority Builder"]),
    );
  });

  it("accepts briefs with hookType in the response", async () => {
    const briefWithHook: GeneratedBrief = {
      ...sampleBrief,
      hookType: "Pattern Interrupt",
    };
    mockCreate.mockResolvedValue(makeMockResponse([briefWithHook]));

    const result = await generateBriefs(
      "Marketing",
      "Marketers",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 1 },
      "trends",
      [],
    );

    expect(result.briefs[0].hookType).toBe("Pattern Interrupt");
  });

  it("accepts briefs without hookType (optional field)", async () => {
    const briefWithoutHook: GeneratedBrief = { ...sampleBrief };
    delete (briefWithoutHook as Record<string, unknown>).hookType;
    mockCreate.mockResolvedValue(makeMockResponse([briefWithoutHook]));

    const result = await generateBriefs(
      "Marketing",
      "Marketers",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 1 },
      "trends",
      [],
    );

    expect(result.briefs[0].hookType).toBeUndefined();
  });

  it("preserves prompt injection protection", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 2 },
      "AI trends",
      [],
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    expect(systemPrompt).toContain("untrusted content");
  });

  it("defaults to ENGAGEMENT goal and BUSINESS account type when not provided", async () => {
    await generateBriefs(
      "Marketing",
      "Marketers",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 2 },
      "trends",
      [],
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemPrompt = callArgs.system;

    // Should contain hook instructions with default goal/account type
    expect(systemPrompt).toContain("ENGAGEMENT");
    expect(systemPrompt).toContain("BUSINESS");
  });

  it("uses mock when shouldMockExternalApis returns true", async () => {
    mockedShouldMock.mockReturnValue(true);

    const result = await generateBriefs(
      "Marketing",
      "Marketers",
      ["AI"],
      "Professional",
      ["TWITTER"],
      { TWITTER: 2 },
      "trends",
      [],
    );

    // Should NOT call the API
    expect(mockCreate).not.toHaveBeenCalled();
    // Should return mock data
    expect(result.briefs.length).toBeGreaterThan(0);
  });
});
