import {
  flattenFormatMix,
  PLATFORM_FORMATS,
  StrategyPatchSchema,
  WizardAnswersSchema,
  stripHtml,
} from "@/lib/strategy/schemas";

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

describe("stripHtml", () => {
  it("removes HTML tags from strings", () => {
    expect(stripHtml("<b>bold</b>")).toBe("bold");
    expect(stripHtml("<script>alert('xss')</script>")).toBe("alert('xss')");
    expect(stripHtml("no tags here")).toBe("no tags here");
  });

  it("handles nested and self-closing tags", () => {
    expect(stripHtml("<div><p>hello</p></div>")).toBe("hello");
    expect(stripHtml("line<br/>break")).toBe("linebreak");
    expect(stripHtml('<img src="x.png" />')).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });
});

describe("StrategyPatchSchema HTML stripping", () => {
  const basePayload = {
    updatedAt: new Date().toISOString(),
  };

  it("strips HTML from industry field", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      industry: "<b>Tech</b>",
    });
    expect(result.industry).toBe("Tech");
  });

  it("strips HTML from targetAudience field", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      targetAudience: "<script>alert('xss')</script>Developers",
    });
    expect(result.targetAudience).toBe("alert('xss')Developers");
  });

  it("strips HTML from brandVoice field", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      brandVoice: "<em>Professional</em> and <strong>authoritative</strong>",
    });
    expect(result.brandVoice).toBe("Professional and authoritative");
  });

  it("strips HTML from visualStyle field", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      visualStyle: "<div>Minimalist</div>",
    });
    expect(result.visualStyle).toBe("Minimalist");
  });

  it("strips HTML from contentPillars array items", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      contentPillars: ["<b>Leadership</b>", "Plain text", "<i>Innovation</i>"],
    });
    expect(result.contentPillars).toEqual([
      "Leadership",
      "Plain text",
      "Innovation",
    ]);
  });

  it("preserves null visualStyle", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      visualStyle: null,
    });
    expect(result.visualStyle).toBeNull();
  });

  it("passes through fields without HTML unchanged", () => {
    const result = StrategyPatchSchema.parse({
      ...basePayload,
      industry: "Technology",
      targetAudience: "B2B SaaS founders",
    });
    expect(result.industry).toBe("Technology");
    expect(result.targetAudience).toBe("B2B SaaS founders");
  });
});

describe("WizardAnswersSchema HTML stripping", () => {
  it("strips HTML from all string fields", () => {
    const result = WizardAnswersSchema.parse({
      businessType: "<b>SaaS</b>",
      targetAudience: "<script>xss</script>Devs",
      tonePreference: "<em>Casual</em>",
      primaryGoal: "<strong>Growth</strong>",
      competitors: "<a href='x'>Rival</a>",
    });
    expect(result.businessType).toBe("SaaS");
    expect(result.targetAudience).toBe("xssDevs");
    expect(result.tonePreference).toBe("Casual");
    expect(result.primaryGoal).toBe("Growth");
    expect(result.competitors).toBe("Rival");
  });
});

describe("PLATFORM_FORMATS", () => {
  it("has valid formats for each platform", () => {
    expect(PLATFORM_FORMATS.TWITTER).toEqual(["TEXT", "IMAGE"]);
    expect(PLATFORM_FORMATS.TIKTOK).toEqual(["VIDEO"]);
    expect(PLATFORM_FORMATS.INSTAGRAM).toContain("CAROUSEL");
  });
});
