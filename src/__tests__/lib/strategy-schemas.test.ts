import { flattenFormatMix, PLATFORM_FORMATS } from "@/lib/strategy/schemas";

describe("flattenFormatMix", () => {
  it("returns null for null/undefined input", () => {
    expect(flattenFormatMix(null)).toBeNull();
    expect(flattenFormatMix(undefined)).toBeNull();
  });

  it("returns flat format as-is (old format)", () => {
    const flat = { TEXT: 0.3, IMAGE: 0.7 };
    expect(flattenFormatMix(flat)).toEqual(flat);
  });

  it("converts per-platform weights to averaged ratios", () => {
    const perPlatform = {
      TWITTER: { TEXT: 3, IMAGE: 2 },
      FACEBOOK: { TEXT: 1, IMAGE: 1 },
    };
    const result = flattenFormatMix(perPlatform);
    expect(result).not.toBeNull();
    // TWITTER: TEXT=3/5=0.6, IMAGE=2/5=0.4
    // FACEBOOK: TEXT=1/2=0.5, IMAGE=1/2=0.5
    // Average: TEXT=(0.6+0.5)/2=0.55, IMAGE=(0.4+0.5)/2=0.45
    expect(result!.TEXT).toBeCloseTo(0.55, 2);
    expect(result!.IMAGE).toBeCloseTo(0.45, 2);
  });

  it("skips null platform entries (AI-optimized)", () => {
    const perPlatform = {
      TWITTER: { TEXT: 5, IMAGE: 5 },
      INSTAGRAM: null,
    };
    const result = flattenFormatMix(perPlatform as Record<string, unknown>);
    expect(result).not.toBeNull();
    expect(result!.TEXT).toBeCloseTo(0.5, 2);
    expect(result!.IMAGE).toBeCloseTo(0.5, 2);
  });

  it("skips platforms with zero total weight", () => {
    const perPlatform = {
      TWITTER: { TEXT: 0, IMAGE: 0 },
      FACEBOOK: { TEXT: 5, IMAGE: 5 },
    };
    const result = flattenFormatMix(perPlatform);
    expect(result).not.toBeNull();
    expect(result!.TEXT).toBeCloseTo(0.5, 2);
    expect(result!.IMAGE).toBeCloseTo(0.5, 2);
  });

  it("returns null when all platforms are AI-optimized (null)", () => {
    expect(flattenFormatMix({ TWITTER: null, INSTAGRAM: null } as Record<string, unknown>)).toBeNull();
  });

  it("returns null for empty object", () => {
    expect(flattenFormatMix({})).toBeNull();
  });
});

describe("PLATFORM_FORMATS", () => {
  it("has valid formats for each platform", () => {
    expect(PLATFORM_FORMATS.TWITTER).toEqual(["TEXT", "IMAGE"]);
    expect(PLATFORM_FORMATS.TIKTOK).toEqual(["VIDEO"]);
    expect(PLATFORM_FORMATS.INSTAGRAM).toContain("CAROUSEL");
  });
});
