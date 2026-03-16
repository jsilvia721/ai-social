// Tests for repurposeContent — uses tool_use to force structured platform variants
// Mock the models module
const mockCreate = jest.fn();
const mockClient = { messages: { create: mockCreate } };

jest.mock("@/lib/ai/models", () => ({
  getAnthropicClient: jest.fn(() => mockClient),
  getModel: jest.fn((tier: string) =>
    tier === "fast" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6"
  ),
  MODEL_DEFAULT: "claude-sonnet-4-6",
  MODEL_FAST: "claude-haiku-4-5-20251001",
}));

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { repurposeContent } from "@/lib/ai/repurpose";
import { MODEL_DEFAULT } from "@/lib/ai/models";
import type { StrategyContext } from "@/lib/ai/types";
import type { Platform } from "@/types";

describe("repurposeContent", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  function makeToolUseResponse(input: Record<string, unknown>) {
    return {
      content: [
        {
          type: "tool_use",
          id: "tool_01",
          name: "generate_platform_variants",
          input,
        },
      ],
    };
  }

  const validStrategy: StrategyContext = {
    industry: "Fitness",
    targetAudience: "Busy professionals aged 25-45",
    contentPillars: ["Workout tips", "Nutrition", "Mindset"],
    brandVoice: "Energetic, motivating, and science-backed.",
  };

  const validResult = {
    coreMessage: "Morning workouts boost productivity by 30%",
    variants: [
      {
        platform: "TWITTER",
        content: "Morning workouts = 30% more productive days. No excuses. #fitness",
        topicPillar: "Workout tips",
        tone: "educational",
      },
      {
        platform: "INSTAGRAM",
        content:
          "Rise and grind! 🌅 Studies show morning workouts boost productivity by 30%. Start your day right. #morningworkout #fitlife #productivity",
        topicPillar: "Workout tips",
        tone: "educational",
      },
    ],
  };

  const defaultInput = {
    sourceContent: "Morning workouts can increase your productivity by 30%.",
    targetPlatforms: ["TWITTER", "INSTAGRAM"] as Platform[],
    strategy: validStrategy,
  };

  it("returns parsed RepurposeResult when Claude calls the tool", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    const result = await repurposeContent(defaultInput);

    expect(result).toEqual(validResult);
  });

  it("calls Anthropic with tool_choice forced to generate_platform_variants", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent(defaultInput);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toBeDefined();
    expect(call.tools[0].name).toBe("generate_platform_variants");
    expect(call.tool_choice).toEqual({ type: "tool", name: "generate_platform_variants" });
  });

  it("throws when Claude returns no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot help with that." }],
    });

    await expect(repurposeContent(defaultInput)).rejects.toThrow(
      "Claude did not call generate_platform_variants"
    );
  });

  it("throws Zod error when tool_use input has wrong shape", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        // missing coreMessage and variants
        platform: "TWITTER",
        content: "just text",
      })
    );

    await expect(repurposeContent(defaultInput)).rejects.toThrow();
  });

  it("throws Zod error when variants array is empty", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        coreMessage: "test",
        variants: [],
      })
    );

    await expect(repurposeContent(defaultInput)).rejects.toThrow();
  });

  it("throws Zod error when variant has invalid platform", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        coreMessage: "test",
        variants: [
          {
            platform: "LINKEDIN",
            content: "some content",
          },
        ],
      })
    );

    await expect(repurposeContent(defaultInput)).rejects.toThrow();
  });

  it("throws Zod error when variant content is empty", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        coreMessage: "test",
        variants: [
          {
            platform: "TWITTER",
            content: "",
          },
        ],
      })
    );

    await expect(repurposeContent(defaultInput)).rejects.toThrow();
  });

  it("accepts variants with nullish topicPillar and tone", async () => {
    const resultWithNulls = {
      coreMessage: "Morning workouts boost productivity",
      variants: [
        {
          platform: "TWITTER",
          content: "Morning workouts boost productivity. #fitness",
          // topicPillar and tone omitted entirely (undefined)
        },
      ],
    };
    mockCreate.mockResolvedValue(makeToolUseResponse(resultWithNulls));

    const result = await repurposeContent(defaultInput);

    expect(result.variants[0].topicPillar).toBeUndefined();
    expect(result.variants[0].tone).toBeUndefined();
  });

  it("uses MODEL_DEFAULT (Sonnet) for repurposeContent", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent(defaultInput);

    expect(mockCreate.mock.calls[0][0].model).toBe(MODEL_DEFAULT);
  });

  it("includes source content in the user message", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent({
      ...defaultInput,
      sourceContent: "Unique source content about morning routines",
    });

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const content =
      typeof userMessage.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage.content);
    expect(content).toContain("Unique source content about morning routines");
  });

  it("includes target platforms in the user message", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent({
      ...defaultInput,
      targetPlatforms: ["FACEBOOK", "TIKTOK"],
    });

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    const content =
      typeof userMessage.content === "string"
        ? userMessage.content
        : JSON.stringify(userMessage.content);
    expect(content).toContain("FACEBOOK");
    expect(content).toContain("TIKTOK");
  });

  it("includes strategy context in the system message", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent(defaultInput);

    const call = mockCreate.mock.calls[0][0];
    const system =
      typeof call.system === "string" ? call.system : JSON.stringify(call.system);
    expect(system).toContain("Fitness");
    expect(system).toContain("Busy professionals aged 25-45");
    expect(system).toContain("Workout tips");
    expect(system).toContain("Energetic, motivating, and science-backed.");
  });

  it("uses system/user message separation", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent(defaultInput);

    const call = mockCreate.mock.calls[0][0];
    // System message should exist and be separate from user messages
    expect(call.system).toBeDefined();
    expect(typeof call.system).toBe("string");
    // Source content should be in user message, not system
    const userMessage = call.messages.find(
      (m: { role: string }) => m.role === "user"
    );
    expect(userMessage).toBeDefined();
  });

  it("sets max_tokens to 4096", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validResult));

    await repurposeContent(defaultInput);

    expect(mockCreate.mock.calls[0][0].max_tokens).toBe(4096);
  });
});
