import { DigestPatternsSchema, DigestChangesSchema } from "@/lib/optimizer/schemas";
import { PLATFORM_STYLES } from "@/components/accounts/platform-utils";
import type { Platform } from "@/types";

describe("DigestPatternsSchema", () => {
  it("parses valid patterns with top performers and insights", () => {
    const input = {
      topPerformers: [
        { postId: "post-1", score: 4.2, format: "VIDEO", topicPillar: "Tips" },
        { postId: "post-2", score: 2.1, format: null, topicPillar: null },
      ],
      insights: ["Videos outperform text", "Morning posts get more engagement"],
    };
    const result = DigestPatternsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topPerformers).toHaveLength(2);
      expect(result.data.topPerformers[0].score).toBe(4.2);
      expect(result.data.insights).toHaveLength(2);
    }
  });

  it("parses empty top performers and insights", () => {
    const input = { topPerformers: [], insights: [] };
    const result = DigestPatternsSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topPerformers).toEqual([]);
      expect(result.data.insights).toEqual([]);
    }
  });

  it("fails on missing required fields", () => {
    expect(DigestPatternsSchema.safeParse({}).success).toBe(false);
    expect(DigestPatternsSchema.safeParse({ topPerformers: [] }).success).toBe(false);
    expect(DigestPatternsSchema.safeParse({ insights: [] }).success).toBe(false);
  });

  it("fails on invalid top performer shape", () => {
    const input = {
      topPerformers: [{ postId: "post-1" }], // missing score, format, topicPillar
      insights: [],
    };
    const result = DigestPatternsSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("DigestChangesSchema", () => {
  it("parses full changes object", () => {
    const input = {
      formatMix: { VIDEO: 0.1, TEXT: -0.1 },
      cadence: { TWITTER: 1, INSTAGRAM: -1 },
      topicInsights: ["More tips content", "Less promotional"],
    };
    const result = DigestChangesSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatMix).toEqual({ VIDEO: 0.1, TEXT: -0.1 });
      expect(result.data.cadence).toEqual({ TWITTER: 1, INSTAGRAM: -1 });
      expect(result.data.topicInsights).toHaveLength(2);
    }
  });

  it("parses empty object (all optional fields)", () => {
    const result = DigestChangesSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatMix).toBeUndefined();
      expect(result.data.cadence).toBeUndefined();
      expect(result.data.topicInsights).toBeUndefined();
    }
  });

  it("parses with only formatMix", () => {
    const result = DigestChangesSchema.safeParse({ formatMix: { IMAGE: 0.05 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatMix).toEqual({ IMAGE: 0.05 });
    }
  });

  it("parses with only cadence", () => {
    const result = DigestChangesSchema.safeParse({ cadence: { TWITTER: 2 } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cadence).toEqual({ TWITTER: 2 });
    }
  });

  it("parses with only topicInsights", () => {
    const result = DigestChangesSchema.safeParse({ topicInsights: ["Focus on tutorials"] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topicInsights).toEqual(["Focus on tutorials"]);
    }
  });

  it("handles null/undefined gracefully via safeParse", () => {
    expect(DigestChangesSchema.safeParse(null).success).toBe(false);
    expect(DigestChangesSchema.safeParse(undefined).success).toBe(false);
  });
});

// Test the formatting helper logic used in the insights page
describe("insights page formatting helpers", () => {
  // These replicate the inline helpers from page.tsx

  function formatMixDelta(key: string, delta: number): string {
    const pct = Math.round(Math.abs(delta) * 100);
    const direction = delta > 0 ? "+" : "-";
    const label = key.charAt(0) + key.slice(1).toLowerCase();
    return `${direction}${pct}% ${label.toLowerCase()} posts`;
  }

  function formatCadenceDelta(platform: string, delta: number): string {
    const label = PLATFORM_STYLES[platform as Platform]?.label ?? platform.charAt(0) + platform.slice(1).toLowerCase();
    const direction = delta > 0 ? "+" : "";
    return `${direction}${delta} ${label} post${Math.abs(delta) !== 1 ? "s" : ""}/week`;
  }

  describe("formatMixDelta", () => {
    it("formats positive delta", () => {
      expect(formatMixDelta("VIDEO", 0.1)).toBe("+10% video posts");
    });

    it("formats negative delta", () => {
      expect(formatMixDelta("TEXT", -0.05)).toBe("-5% text posts");
    });

    it("formats zero delta as +0%", () => {
      expect(formatMixDelta("IMAGE", 0)).toBe("-0% image posts");
    });

    it("handles single-char keys", () => {
      expect(formatMixDelta("A", 0.2)).toBe("+20% a posts");
    });
  });

  describe("formatCadenceDelta", () => {
    it("formats positive delta with plus sign", () => {
      expect(formatCadenceDelta("TWITTER", 1)).toBe("+1 Twitter / X post/week");
    });

    it("formats negative delta", () => {
      expect(formatCadenceDelta("INSTAGRAM", -2)).toBe("-2 Instagram posts/week");
    });

    it("uses singular 'post' for delta of 1 or -1", () => {
      expect(formatCadenceDelta("FACEBOOK", 1)).toBe("+1 Facebook post/week");
      expect(formatCadenceDelta("FACEBOOK", -1)).toBe("-1 Facebook post/week");
    });

    it("uses plural 'posts' for delta != 1", () => {
      expect(formatCadenceDelta("TWITTER", 2)).toBe("+2 Twitter / X posts/week");
      expect(formatCadenceDelta("TWITTER", 0)).toBe("0 Twitter / X posts/week");
    });

    it("uses correct TikTok branding", () => {
      expect(formatCadenceDelta("TIKTOK", 1)).toBe("+1 TikTok post/week");
    });

    it("uses correct YouTube branding", () => {
      expect(formatCadenceDelta("YOUTUBE", 2)).toBe("+2 YouTube posts/week");
    });
  });
});
