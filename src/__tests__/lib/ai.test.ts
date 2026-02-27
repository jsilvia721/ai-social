// Mock the Anthropic SDK before importing anything that uses it.
// lib/ai/index.ts runs `const client = new Anthropic()` at module load,
// so the mock must be in place before the module is evaluated.
// __esModule: true is required for correct default import interop.
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  })),
}));

import Anthropic from "@anthropic-ai/sdk";
// lib/ai/index.ts calls `new Anthropic()` at module load time.
// mock.results[0].value is the return value of that constructor call
// (the object with messages.create), not the `this` object (mock.instances[0]).
const getCreateSpy = (): jest.Mock =>
  (Anthropic as jest.Mock).mock.results[0]?.value?.messages?.create;

import { generatePostContent, suggestOptimalTimes } from "@/lib/ai";
import type { Platform } from "@/types";

describe("generatePostContent", () => {
  let mockCreate: jest.Mock;

  beforeEach(() => {
    mockCreate = getCreateSpy();
    mockCreate?.mockReset();
  });

  function makeTextResponse(text: string) {
    return { content: [{ type: "text", text }] };
  }

  it("returns the AI-generated text for TWITTER", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("Check out this cool thing! #tech"));

    const result = await generatePostContent("AI tools", "TWITTER");

    expect(result).toBe("Check out this cool thing! #tech");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("includes TWITTER platform guide in the prompt", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("tweet text"));

    await generatePostContent("AI tools", "TWITTER");

    const call = mockCreate.mock.calls[0][0];
    const prompt = call.messages[0].content as string;
    expect(prompt).toContain("280 characters");
    expect(prompt).toContain("TWITTER");
  });

  it("includes INSTAGRAM platform guide in the prompt", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("instagram post"));

    await generatePostContent("travel", "INSTAGRAM");

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("hashtags");
    expect(prompt).toContain("INSTAGRAM");
  });

  it("includes FACEBOOK platform guide in the prompt", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("facebook post"));

    await generatePostContent("news", "FACEBOOK");

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("FACEBOOK");
  });

  it("includes tone in the prompt when provided", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("professional post"));

    await generatePostContent("product launch", "TWITTER", "professional");

    const prompt = mockCreate.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("professional");
  });

  it("throws when AI response type is not text", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "x", name: "x", input: {} }],
    });

    await expect(generatePostContent("topic", "TWITTER")).rejects.toThrow(
      "Unexpected response type from AI"
    );
  });
});

describe("suggestOptimalTimes", () => {
  const FIXED_NOW = new Date("2025-01-15T08:00:00.000Z"); // 8 AM UTC

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each<[Platform, number[]]>([
    ["TWITTER", [9, 12, 17]],
    ["INSTAGRAM", [11, 14, 19]],
    ["FACEBOOK", [9, 13, 16]],
  ])("returns 3 times for %s at hours %p", async (platform, expectedHours) => {
    const times = await suggestOptimalTimes(platform, "UTC");

    expect(times).toHaveLength(3);
    const hours = times.map((t) => t.getHours());
    expect(hours).toEqual(expectedHours);
  });

  it("returns dates in the future relative to now", async () => {
    const times = await suggestOptimalTimes("TWITTER", "UTC");

    for (const t of times) {
      expect(t.getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    }
  });
});
