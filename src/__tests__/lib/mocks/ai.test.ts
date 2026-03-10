import {
  mockGeneratePostContent,
  mockExtractContentStrategy,
  mockAnalyzePerformance,
  mockSynthesizeResearch,
  mockGenerateBriefs,
} from "@/lib/mocks/ai";

describe("AI mock data", () => {
  describe("mockGeneratePostContent", () => {
    it("returns a string for each platform", () => {
      const platforms = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;
      for (const platform of platforms) {
        const result = mockGeneratePostContent("test topic", platform);
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(10);
      }
    });
  });

  describe("mockExtractContentStrategy", () => {
    it("returns valid ContentStrategyInput shape", () => {
      const result = mockExtractContentStrategy({ "Business type": "SaaS" });
      expect(result.industry).toBe("SaaS");
      expect(result.targetAudience).toBeTruthy();
      expect(result.contentPillars.length).toBeGreaterThanOrEqual(1);
      expect(result.brandVoice).toBeTruthy();
      expect(["ENGAGEMENT", "REACH", "CONVERSIONS", "BRAND_AWARENESS"]).toContain(
        result.optimizationGoal
      );
      expect(typeof result.reviewWindowEnabled).toBe("boolean");
      expect(typeof result.reviewWindowHours).toBe("number");
    });

    it("falls back to defaults when keys are missing", () => {
      const result = mockExtractContentStrategy({});
      expect(result.industry).toBe("Technology & SaaS");
    });
  });

  describe("mockAnalyzePerformance", () => {
    it("returns patterns and digest", () => {
      const result = mockAnalyzePerformance();
      expect(result.patterns.length).toBeGreaterThanOrEqual(3);
      expect(result.digest).toBeTruthy();
      expect(result.digest).toContain("[MOCK]");
    });
  });

  describe("mockSynthesizeResearch", () => {
    it("returns themes with valid shape", () => {
      const result = mockSynthesizeResearch();
      expect(result.themes.length).toBeGreaterThanOrEqual(1);
      for (const theme of result.themes) {
        expect(theme.title).toBeTruthy();
        expect(theme.summary).toBeTruthy();
        expect(theme.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(theme.relevanceScore).toBeLessThanOrEqual(1);
        expect(theme.suggestedAngles.length).toBeGreaterThanOrEqual(1);
      }
      expect(result.overallSummary).toContain("[MOCK]");
    });
  });

  describe("mockGenerateBriefs", () => {
    it("generates briefs matching platform cadence", () => {
      const result = mockGenerateBriefs(
        ["TWITTER", "INSTAGRAM"],
        { TWITTER: 3, INSTAGRAM: 2 }
      );
      expect(result.briefs.length).toBe(5);
      const twitterBriefs = result.briefs.filter((b) => b.platform === "TWITTER");
      const instaBriefs = result.briefs.filter((b) => b.platform === "INSTAGRAM");
      expect(twitterBriefs.length).toBe(3);
      expect(instaBriefs.length).toBe(2);
    });

    it("each brief has required fields", () => {
      const result = mockGenerateBriefs(["FACEBOOK"], { FACEBOOK: 1 });
      const brief = result.briefs[0];
      expect(brief.topic).toBeTruthy();
      expect(brief.rationale).toBeTruthy();
      expect(brief.suggestedCaption).toBeTruthy();
      expect(brief.recommendedFormat).toBeTruthy();
      expect(brief.platform).toBe("FACEBOOK");
      expect(brief.suggestedDay).toBeTruthy();
    });
  });
});
