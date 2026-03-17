/**
 * Tests for generatePostContent with platform intelligence enrichment.
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

import { generatePostContent } from "@/lib/ai/index";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("generatePostContent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "Here is a great post about AI!" }],
    });
  });

  it("includes platform intelligence in the prompt", async () => {
    await generatePostContent("AI in marketing", "TWITTER");

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    // Should include rich platform intelligence instead of thin guide
    expect(userMsg).toContain("TWITTER Intelligence");
    expect(userMsg).toContain("Algorithm Signals");
    expect(userMsg).toContain("Character Limits");
  });

  it("includes hook framework guidance", async () => {
    await generatePostContent("AI in marketing", "TWITTER");

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    // Should include hook guidance
    expect(userMsg).toContain("Hook Frameworks");
  });

  it("includes personality hint for MEME account type", async () => {
    await generatePostContent("AI trends", "TIKTOK", {
      creative: { accountType: "MEME" },
    });

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    expect(userMsg).toContain("casual");
    expect(userMsg).toContain("funny");
  });

  it("uses INSTAGRAM platform intelligence for Instagram posts", async () => {
    await generatePostContent("Photography tips", "INSTAGRAM");

    const callArgs = mockCreate.mock.calls[0][0];
    const userMsg = callArgs.messages[0].content;

    expect(userMsg).toContain("INSTAGRAM Intelligence");
    expect(userMsg).toContain("saves");
  });
});
