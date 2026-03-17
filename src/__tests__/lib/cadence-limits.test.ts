/**
 * Tests for growth-aware cadence enforcement.
 */

import {
  getMaxDailyPosts,
  clampCadence,
  DAYS_PER_WEEK,
} from "@/lib/cadence-limits";

describe("getMaxDailyPosts", () => {
  it("returns Twitter daily limit", () => {
    expect(getMaxDailyPosts("TWITTER")).toBe(5); // conservative default (<10k)
  });

  it("returns higher Twitter limit with follower count above threshold", () => {
    expect(getMaxDailyPosts("TWITTER", 15_000)).toBe(15);
  });

  it("returns Instagram daily limit", () => {
    expect(getMaxDailyPosts("INSTAGRAM")).toBe(5);
  });

  it("returns TikTok daily limit", () => {
    expect(getMaxDailyPosts("TIKTOK")).toBe(5);
  });

  it("returns Facebook daily limit", () => {
    expect(getMaxDailyPosts("FACEBOOK")).toBe(4);
  });

  it("returns YouTube daily limit", () => {
    expect(getMaxDailyPosts("YOUTUBE")).toBe(5);
  });
});

describe("clampCadence", () => {
  it("does not clamp values within limits", () => {
    const cadence = { TWITTER: 10, INSTAGRAM: 7 };
    const result = clampCadence(cadence);

    expect(result.TWITTER).toBe(10);
    expect(result.INSTAGRAM).toBe(7);
  });

  it("clamps values exceeding weekly max", () => {
    // Twitter max = 5/day * 7 = 35/week
    const cadence = { TWITTER: 50 };
    const result = clampCadence(cadence);

    expect(result.TWITTER).toBe(5 * DAYS_PER_WEEK); // 35
  });

  it("clamps each platform independently", () => {
    const cadence = {
      TWITTER: 50,   // exceeds 35
      FACEBOOK: 50,  // exceeds 28
      INSTAGRAM: 3,  // within 35
    };
    const result = clampCadence(cadence);

    expect(result.TWITTER).toBe(35);
    expect(result.FACEBOOK).toBe(28);
    expect(result.INSTAGRAM).toBe(3);
  });

  it("skips clamping when override is enabled", () => {
    const cadence = { TWITTER: 100 };
    const result = clampCadence(cadence, true);

    expect(result.TWITTER).toBe(100);
  });

  it("still logs warning when override exceeds limits", () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
    const cadence = { TWITTER: 100 };
    clampCadence(cadence, true);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("TWITTER"),
    );
    consoleSpy.mockRestore();
  });

  it("handles empty cadence object", () => {
    const result = clampCadence({});
    expect(result).toEqual({});
  });

  it("preserves platforms not in PLATFORM_INTELLIGENCE as-is", () => {
    // If a platform is passed that's not in our intelligence data, pass through
    const cadence = { TWITTER: 5, UNKNOWN_PLATFORM: 99 } as Record<string, number>;
    const result = clampCadence(cadence);

    expect(result.TWITTER).toBe(5);
    expect(result.UNKNOWN_PLATFORM).toBe(99);
  });
});
