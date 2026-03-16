import {
  HOOK_FRAMEWORKS,
  selectHooks,
  buildHookInstructions,
  type HookFramework,
  type Platform,
  type OptimizationGoal,
  type AccountType,
} from "@/lib/ai/knowledge/hooks";

describe("HOOK_FRAMEWORKS", () => {
  it("exports exactly 10 hook types", () => {
    expect(HOOK_FRAMEWORKS).toHaveLength(10);
  });

  it("each hook has required fields", () => {
    for (const hook of HOOK_FRAMEWORKS) {
      expect(hook.name).toBeTruthy();
      expect(hook.description).toBeTruthy();
      expect(hook.examples.length).toBeGreaterThanOrEqual(2);
      expect(hook.examples.length).toBeLessThanOrEqual(3);
      expect(typeof hook.platformAffinity).toBe("object");
    }
  });

  it("platform affinity scores are between 0 and 1", () => {
    for (const hook of HOOK_FRAMEWORKS) {
      for (const [platform, score] of Object.entries(hook.platformAffinity)) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("includes all 10 known hook types by name", () => {
    const names = HOOK_FRAMEWORKS.map((h) => h.name);
    expect(names).toContain("Pattern Interrupt");
    expect(names).toContain("Authority Builder");
    expect(names).toContain("Problem-Agitate-Solution");
    expect(names).toContain("Hidden Secret");
    expect(names).toContain("Before/After Bridge");
    expect(names).toContain("Educational");
    expect(names).toContain("Social Proof");
    expect(names).toContain("Myth Buster");
    expect(names).toContain("Quick Win");
    expect(names).toContain("FOMO");
  });
});

describe("selectHooks", () => {
  it("returns 3-4 hooks", () => {
    const result = selectHooks("TWITTER", "ENGAGEMENT", "BUSINESS");
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(4);
  });

  it("returns different hooks for different platforms", () => {
    const twitter = selectHooks("TWITTER", "ENGAGEMENT", "BUSINESS");
    const tiktok = selectHooks("TIKTOK", "ENGAGEMENT", "BUSINESS");
    const twitterNames = twitter.map((h) => h.name);
    const tiktokNames = tiktok.map((h) => h.name);
    // At least one hook should differ between platforms
    const allSame = twitterNames.every((n) => tiktokNames.includes(n));
    // They might overlap but shouldn't be identical for very different platforms
    expect(twitterNames).not.toEqual(tiktokNames);
  });

  it("returns different hooks for different optimization goals", () => {
    const engagement = selectHooks("TWITTER", "ENGAGEMENT", "BUSINESS");
    const conversions = selectHooks("TWITTER", "CONVERSIONS", "BUSINESS");
    const engNames = engagement.map((h) => h.name);
    const convNames = conversions.map((h) => h.name);
    expect(engNames).not.toEqual(convNames);
  });

  it("returns different hooks for MEME vs BUSINESS account types", () => {
    const meme = selectHooks("INSTAGRAM", "ENGAGEMENT", "MEME");
    const business = selectHooks("INSTAGRAM", "ENGAGEMENT", "BUSINESS");
    const memeNames = meme.map((h) => h.name);
    const bizNames = business.map((h) => h.name);
    expect(memeNames).not.toEqual(bizNames);
  });

  it("returns valid HookFramework objects", () => {
    const result = selectHooks("INSTAGRAM", "REACH", "INFLUENCER");
    for (const hook of result) {
      expect(hook.name).toBeTruthy();
      expect(hook.description).toBeTruthy();
      expect(hook.examples.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("works for all platform types", () => {
    const platforms: Platform[] = [
      "TWITTER",
      "INSTAGRAM",
      "FACEBOOK",
      "TIKTOK",
      "YOUTUBE",
    ];
    for (const platform of platforms) {
      const result = selectHooks(platform, "ENGAGEMENT", "BUSINESS");
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThanOrEqual(4);
    }
  });

  it("works for all optimization goals", () => {
    const goals: OptimizationGoal[] = [
      "ENGAGEMENT",
      "REACH",
      "CONVERSIONS",
      "BRAND_AWARENESS",
    ];
    for (const goal of goals) {
      const result = selectHooks("TWITTER", goal, "BUSINESS");
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThanOrEqual(4);
    }
  });

  it("works for all account types", () => {
    const types: AccountType[] = ["BUSINESS", "INFLUENCER", "MEME"];
    for (const type of types) {
      const result = selectHooks("TWITTER", "ENGAGEMENT", type);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThanOrEqual(4);
    }
  });
});

describe("buildHookInstructions", () => {
  it("returns a non-empty string", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes diversity enforcement language", () => {
    const result = buildHookInstructions(
      ["TWITTER", "INSTAGRAM"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    expect(result.toLowerCase()).toMatch(/divers|different hook|vary/);
  });

  it("includes hook names in the output", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    // Should reference at least some of the 10 hook types
    const hookNames = HOOK_FRAMEWORKS.map((h) => h.name);
    const mentionedHooks = hookNames.filter((name) => result.includes(name));
    expect(mentionedHooks.length).toBeGreaterThanOrEqual(3);
  });

  it("includes recommended hooks for the given context", () => {
    const result = buildHookInstructions(
      ["TIKTOK"],
      "ENGAGEMENT",
      "MEME"
    );
    // Should contain "prefer" or "recommended" language with specific hooks
    expect(result.toLowerCase()).toMatch(/prefer|recommend|prioritize/);
  });

  it("handles multiple platforms", () => {
    const result = buildHookInstructions(
      ["TWITTER", "INSTAGRAM", "TIKTOK"],
      "REACH",
      "INFLUENCER"
    );
    expect(result.length).toBeGreaterThan(0);
    // Should mention at least 3 different hook types
    const hookNames = HOOK_FRAMEWORKS.map((h) => h.name);
    const mentionedHooks = hookNames.filter((name) => result.includes(name));
    expect(mentionedHooks.length).toBeGreaterThanOrEqual(3);
  });

  it("includes example openers", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    // Should include at least some example openers from the hook frameworks
    const allExamples = HOOK_FRAMEWORKS.flatMap((h) => h.examples);
    const hasExamples = allExamples.some((ex) => result.includes(ex));
    expect(hasExamples).toBe(true);
  });
});
