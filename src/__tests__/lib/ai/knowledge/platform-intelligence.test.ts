import type { Platform } from "@/types";
import {
  PLATFORM_INTELLIGENCE,
  buildPlatformPrompt,
  buildCrossPlatformGuidelines,
} from "@/lib/ai/knowledge/platform-intelligence";

const ALL_PLATFORMS: Platform[] = [
  "TWITTER",
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
];

describe("PLATFORM_INTELLIGENCE", () => {
  it("covers all 5 platforms", () => {
    expect(Object.keys(PLATFORM_INTELLIGENCE).sort()).toEqual(
      ALL_PLATFORMS.slice().sort()
    );
  });

  it.each(ALL_PLATFORMS)(
    "%s has required character limit fields",
    (platform) => {
      const intel = PLATFORM_INTELLIGENCE[platform];
      expect(intel.limits.maxChars).toBeGreaterThan(0);
      expect(intel.limits.optimalChars).toBeGreaterThan(0);
      expect(intel.limits.optimalChars).toBeLessThanOrEqual(
        intel.limits.maxChars
      );
    }
  );

  it.each(ALL_PLATFORMS)("%s has hashtag strategy", (platform) => {
    const intel = PLATFORM_INTELLIGENCE[platform];
    expect(intel.hashtags.recommended).toBeDefined();
    expect(typeof intel.hashtags.strategy).toBe("string");
    expect(intel.hashtags.strategy.length).toBeGreaterThan(0);
  });

  it.each(ALL_PLATFORMS)(
    "%s has algorithm weights that sum to a positive number",
    (platform) => {
      const weights = PLATFORM_INTELLIGENCE[platform].algorithm.weights;
      const total = Object.values(weights).reduce(
        (sum, val) => sum + val,
        0
      );
      expect(total).toBeGreaterThan(0);
      // All weights should be positive
      Object.values(weights).forEach((w) => expect(w).toBeGreaterThan(0));
    }
  );

  it.each(ALL_PLATFORMS)("%s has cadence limits", (platform) => {
    const cadence = PLATFORM_INTELLIGENCE[platform].cadence;
    expect(cadence.maxPerDay).toBeGreaterThan(0);
    expect(typeof cadence.notes).toBe("string");
  });

  it.each(ALL_PLATFORMS)("%s has content format best practices", (platform) => {
    const intel = PLATFORM_INTELLIGENCE[platform];
    expect(intel.bestPractices.length).toBeGreaterThan(0);
  });

  it.each(ALL_PLATFORMS)("%s has tone/voice guidance", (platform) => {
    const intel = PLATFORM_INTELLIGENCE[platform];
    expect(intel.tone.length).toBeGreaterThan(0);
  });

  it.each(ALL_PLATFORMS)("%s has native content rules", (platform) => {
    const intel = PLATFORM_INTELLIGENCE[platform];
    expect(intel.nativeRules.length).toBeGreaterThan(0);
  });

  it.each(ALL_PLATFORMS)("%s has doNot rules", (platform) => {
    const intel = PLATFORM_INTELLIGENCE[platform];
    expect(intel.doNot.length).toBeGreaterThan(0);
  });

  // Specific platform data validations
  describe("Twitter-specific intelligence", () => {
    it("has 280 char max", () => {
      expect(PLATFORM_INTELLIGENCE.TWITTER.limits.maxChars).toBe(280);
    });

    it("algorithm weights include reposts as highest signal", () => {
      const weights = PLATFORM_INTELLIGENCE.TWITTER.algorithm.weights;
      expect(weights.reposts).toBeGreaterThan(weights.likes);
    });

    it("has time decay info", () => {
      expect(
        PLATFORM_INTELLIGENCE.TWITTER.algorithm.timeDecay
      ).toBeDefined();
    });
  });

  describe("Instagram-specific intelligence", () => {
    it("algorithm weights saves as primary factor", () => {
      const weights = PLATFORM_INTELLIGENCE.INSTAGRAM.algorithm.weights;
      expect(weights.saves).toBeGreaterThanOrEqual(weights.likes);
    });
  });

  describe("TikTok-specific intelligence", () => {
    it("has 4000 char max for captions", () => {
      expect(PLATFORM_INTELLIGENCE.TIKTOK.limits.maxChars).toBe(4000);
    });
  });

  describe("YouTube-specific intelligence", () => {
    it("has SEO title guidance", () => {
      const prompt = buildPlatformPrompt("YOUTUBE");
      expect(prompt).toMatch(/SEO|title/i);
    });
  });
});

describe("buildPlatformPrompt", () => {
  it("returns a non-empty string for each platform", () => {
    ALL_PLATFORMS.forEach((platform) => {
      const prompt = buildPlatformPrompt(platform);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(100);
    });
  });

  it("includes character limits in output", () => {
    const prompt = buildPlatformPrompt("TWITTER");
    expect(prompt).toContain("280");
  });

  it("includes algorithm weights in output", () => {
    const prompt = buildPlatformPrompt("TWITTER");
    expect(prompt).toMatch(/repost/i);
  });

  it("includes hashtag strategy", () => {
    const prompt = buildPlatformPrompt("INSTAGRAM");
    expect(prompt).toMatch(/hashtag/i);
  });

  it("includes cadence limits", () => {
    const prompt = buildPlatformPrompt("TIKTOK");
    expect(prompt).toMatch(/per day|\/day/i);
  });

  it("includes doNot rules", () => {
    const prompt = buildPlatformPrompt("FACEBOOK");
    expect(prompt).toMatch(/don't|do not|avoid/i);
  });

  it("includes tone guidance", () => {
    const prompt = buildPlatformPrompt("TWITTER");
    expect(prompt).toMatch(/tone|voice/i);
  });

  it("includes native content rules", () => {
    const prompt = buildPlatformPrompt("INSTAGRAM");
    expect(prompt).toMatch(/native|original/i);
  });

  it("adjusts cadence based on follower count (growth stage)", () => {
    const smallPrompt = buildPlatformPrompt("TWITTER", {
      followerCount: 5000,
    });
    const largePrompt = buildPlatformPrompt("TWITTER", {
      followerCount: 50000,
    });
    expect(smallPrompt).toContain("5 per day");
    expect(largePrompt).toContain("15 per day");
    // Small account should NOT show 15/day
    expect(smallPrompt).not.toContain("15 per day");
  });
});

describe("buildCrossPlatformGuidelines", () => {
  it("returns a non-empty string", () => {
    const guidelines = buildCrossPlatformGuidelines();
    expect(typeof guidelines).toBe("string");
    expect(guidelines.length).toBeGreaterThan(50);
  });

  it("mentions angle/hook/structure diversity", () => {
    const guidelines = buildCrossPlatformGuidelines();
    expect(guidelines).toMatch(/angle/i);
    expect(guidelines).toMatch(/hook|structure/i);
  });

  it("emphasizes platform-native feel", () => {
    const guidelines = buildCrossPlatformGuidelines();
    expect(guidelines).toMatch(/native|lives on that platform/i);
  });

  it("warns against copy-pasting", () => {
    const guidelines = buildCrossPlatformGuidelines();
    expect(guidelines).toMatch(/copy|paste|duplicate|same text/i);
  });

  it("accepts a list of target platforms", () => {
    const guidelines = buildCrossPlatformGuidelines([
      "TWITTER",
      "INSTAGRAM",
    ]);
    expect(guidelines).toContain("TWITTER");
    expect(guidelines).toContain("INSTAGRAM");
  });
});
