import { buildImagePrompt } from "@/lib/ai/prompts";

describe("buildImagePrompt", () => {
  const basePrompt = "A marketing dashboard showing analytics";

  it("adds professional style for BUSINESS account type", () => {
    const result = buildImagePrompt(basePrompt, { accountType: "BUSINESS" });
    expect(result).toContain(basePrompt);
    expect(result).toContain("professional");
  });

  it("adds influencer style for INFLUENCER account type", () => {
    const result = buildImagePrompt(basePrompt, { accountType: "INFLUENCER" });
    expect(result).toContain(basePrompt);
    expect(result).toContain("aspirational");
  });

  it("adds meme style for MEME account type", () => {
    const result = buildImagePrompt(basePrompt, { accountType: "MEME" });
    expect(result).toContain(basePrompt);
    expect(result).toContain("meme");
  });

  it("defaults to professional style when accountType is undefined", () => {
    const result = buildImagePrompt(basePrompt, {});
    expect(result).toContain("professional");
  });

  it("includes visualStyle when provided", () => {
    const result = buildImagePrompt(basePrompt, {
      accountType: "BUSINESS",
      visualStyle: "clean minimalist with blue tones",
    });
    expect(result).toContain('Visual direction: "clean minimalist with blue tones"');
  });

  it("skips visualStyle when null", () => {
    const result = buildImagePrompt(basePrompt, {
      accountType: "BUSINESS",
      visualStyle: null,
    });
    expect(result).not.toContain("Visual direction");
  });

  it("skips visualStyle when empty string", () => {
    const result = buildImagePrompt(basePrompt, {
      accountType: "BUSINESS",
      visualStyle: "",
    });
    expect(result).not.toContain("Visual direction");
  });

  it("sanitizes visualStyle: strips control characters", () => {
    const result = buildImagePrompt(basePrompt, {
      visualStyle: "clean\x00minimal\x1Fist",
    });
    expect(result).toContain('Visual direction: "cleanminimalist"');
  });

  it("sanitizes visualStyle: truncates to 500 chars", () => {
    const longStyle = "x".repeat(700);
    const result = buildImagePrompt(basePrompt, { visualStyle: longStyle });
    // The quoted visual direction should have exactly 500 chars of content
    expect(result).toContain(`Visual direction: "${"x".repeat(500)}"`);
  });
});
