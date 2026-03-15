import { buildVideoPrompt } from "@/lib/ai/prompts";

describe("buildVideoPrompt", () => {
  const basePrompt = "A person walking through a city";

  describe("accountType-specific style directives", () => {
    it("appends meme style for MEME accountType", () => {
      const result = buildVideoPrompt(basePrompt, { accountType: "MEME" }, "TIKTOK", "9:16");

      expect(result).toContain(basePrompt);
      expect(result).toContain("fast cuts, bold visuals");
    });

    it("appends influencer style for INFLUENCER accountType", () => {
      const result = buildVideoPrompt(
        basePrompt,
        { accountType: "INFLUENCER" },
        "INSTAGRAM",
        "9:16"
      );

      expect(result).toContain("smooth tracking, warm tones");
    });

    it("appends business style for BUSINESS accountType", () => {
      const result = buildVideoPrompt(
        basePrompt,
        { accountType: "BUSINESS" },
        "YOUTUBE",
        "16:9"
      );

      expect(result).toContain("clean transitions, professional");
    });

    it("defaults to business style when accountType is undefined", () => {
      const result = buildVideoPrompt(basePrompt, {}, "YOUTUBE", "16:9");

      expect(result).toContain("clean transitions, professional");
    });
  });

  describe("visualStyle", () => {
    it("appends sanitized visualStyle when provided", () => {
      const result = buildVideoPrompt(
        basePrompt,
        { accountType: "BUSINESS", visualStyle: "Cinematic drone shots" },
        "YOUTUBE",
        "16:9"
      );

      expect(result).toContain('Visual direction: "Cinematic drone shots"');
    });

    it("strips control characters from visualStyle", () => {
      const result = buildVideoPrompt(
        basePrompt,
        { accountType: "BUSINESS", visualStyle: "test\x00style\x1F" },
        "YOUTUBE",
        "16:9"
      );

      expect(result).toContain('Visual direction: "teststyle"');
      expect(result).not.toContain("\x00");
      expect(result).not.toContain("\x1F");
    });

    it("omits visualStyle when null", () => {
      const result = buildVideoPrompt(
        basePrompt,
        { accountType: "BUSINESS", visualStyle: null },
        "YOUTUBE",
        "16:9"
      );

      expect(result).not.toContain("Visual direction");
    });
  });

  describe("platform hint", () => {
    it("appends platform hint for TIKTOK", () => {
      const result = buildVideoPrompt(basePrompt, {}, "TIKTOK", "9:16");

      expect(result).toContain("TIKTOK");
      expect(result).toContain("9:16");
    });

    it("appends platform hint for YOUTUBE", () => {
      const result = buildVideoPrompt(basePrompt, {}, "YOUTUBE", "16:9");

      expect(result).toContain("YOUTUBE");
      expect(result).toContain("16:9");
    });
  });

  describe("text overlay directive", () => {
    it("appends text overlay instruction", () => {
      const result = buildVideoPrompt(basePrompt, {}, "TIKTOK", "9:16");

      expect(result).toContain("clear negative space in upper third for text overlay");
    });
  });
});
