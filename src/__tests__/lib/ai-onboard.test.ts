// Tests for extractContentStrategy — uses tool_use to force structured extraction
// Mock AI models module — production code imports getAnthropicClient from here
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
import { extractContentStrategy } from "@/lib/ai";
import { MODEL_DEFAULT } from "@/lib/ai/models";

describe("extractContentStrategy", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  function makeToolUseResponse(input: Record<string, unknown>) {
    return {
      content: [
        {
          type: "tool_use",
          id: "tool_01",
          name: "save_content_strategy",
          input,
        },
      ],
    };
  }

  const validInput = {
    industry: "Fitness",
    targetAudience: "Busy professionals aged 25-45",
    contentPillars: ["Workout tips", "Nutrition", "Mindset"],
    brandVoice:
      "Energetic, motivating, and science-backed. We cut through the noise and deliver practical advice busy people can actually use.",
    optimizationGoal: "ENGAGEMENT",
    reviewWindowEnabled: false,
    reviewWindowHours: 24,
    accountType: "BUSINESS",
    visualStyle: "",
  };

  it("calls Anthropic with tool_use and pinned tool_choice", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validInput));

    await extractContentStrategy({ businessType: "Fitness studio" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.tools).toBeDefined();
    expect(call.tools[0].name).toBe("save_content_strategy");
    expect(call.tool_choice).toEqual({ type: "tool", name: "save_content_strategy" });
    expect(call.system).toBeDefined();
  });

  it("returns parsed ContentStrategy when Claude calls the tool", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validInput));

    const result = await extractContentStrategy({
      businessType: "Fitness studio",
      targetAudience: "Busy professionals",
    });

    expect(result).toEqual(validInput);
  });

  it("throws when Claude returns no tool_use block", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot help with that." }],
    });

    await expect(
      extractContentStrategy({ businessType: "Fitness" })
    ).rejects.toThrow("Claude did not call save_content_strategy");
  });

  it("throws Zod error when tool_use input has wrong shape", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        industry: "Fitness",
        // missing required fields: targetAudience, contentPillars, brandVoice, optimizationGoal
      })
    );

    await expect(
      extractContentStrategy({ businessType: "Fitness" })
    ).rejects.toThrow();
  });

  it("includes wizard answers in the prompt messages", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validInput));

    await extractContentStrategy({
      businessType: "Online coaching",
      targetAudience: "Female entrepreneurs",
      tonePreference: "Professional but warm",
    });

    const call = mockCreate.mock.calls[0][0];
    const lastMessage = call.messages[call.messages.length - 1];
    const content =
      typeof lastMessage.content === "string"
        ? lastMessage.content
        : JSON.stringify(lastMessage.content);
    expect(content).toContain("Online coaching");
    expect(content).toContain("Female entrepreneurs");
  });

  it("uses MODEL_DEFAULT (Sonnet) for extractContentStrategy", async () => {
    mockCreate.mockResolvedValue(makeToolUseResponse(validInput));

    await extractContentStrategy({ businessType: "Retail" });

    expect(mockCreate.mock.calls[0][0].model).toBe(MODEL_DEFAULT);
  });

  it("optimizationGoal must be one of the enum values", async () => {
    mockCreate.mockResolvedValue(
      makeToolUseResponse({
        ...validInput,
        optimizationGoal: "INVALID_GOAL",
      })
    );

    await expect(
      extractContentStrategy({ businessType: "Fitness" })
    ).rejects.toThrow();
  });
});
