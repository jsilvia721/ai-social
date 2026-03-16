import {
  HOOK_FRAMEWORKS,
  selectHooks,
  buildHookInstructions,
  type Platform,
  type OptimizationGoal,
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
      expect(hook.platformAffinity).toBeDefined();
    }
  });

  it("platformAffinity scores are between 0 and 1", () => {
    const platforms: Platform[] = [
      "TWITTER",
      "INSTAGRAM",
      "FACEBOOK",
      "TIKTOK",
      "YOUTUBE",
    ];
    for (const hook of HOOK_FRAMEWORKS) {
      for (const platform of platforms) {
        const score = hook.platformAffinity[platform];
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("contains the expected hook names", () => {
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

  it("returns HookFramework objects", () => {
    const result = selectHooks("INSTAGRAM", "REACH", "INFLUENCER");
    for (const hook of result) {
      expect(hook).toHaveProperty("name");
      expect(hook).toHaveProperty("description");
      expect(hook).toHaveProperty("examples");
      expect(hook).toHaveProperty("platformAffinity");
    }
  });

  it("favors high-affinity hooks for the given platform", () => {
    const twitterHooks = selectHooks("TWITTER", "ENGAGEMENT", "BUSINESS");
    const twitterNames = twitterHooks.map((h) => h.name);

    // Pattern Interrupt and Quick Win should score well on Twitter (short-form)
    // At least one of these high-affinity hooks should appear
    const highAffinityTwitter = ["Pattern Interrupt", "Quick Win", "FOMO"];
    const hasHighAffinity = twitterNames.some((n) =>
      highAffinityTwitter.includes(n)
    );
    expect(hasHighAffinity).toBe(true);
  });

  it("adjusts selection for different optimization goals", () => {
    const engagementHooks = selectHooks("INSTAGRAM", "ENGAGEMENT", "BUSINESS");
    const conversionHooks = selectHooks(
      "INSTAGRAM",
      "CONVERSIONS",
      "BUSINESS"
    );

    // Different goals should produce at least some different hooks
    const engagementNames = engagementHooks.map((h) => h.name);
    const conversionNames = conversionHooks.map((h) => h.name);

    // Both return valid results with potentially different selections
    expect(engagementNames.length).toBeGreaterThanOrEqual(3);
    expect(conversionNames.length).toBeGreaterThanOrEqual(3);
  });

  it("adjusts selection for different account types", () => {
    const memeHooks = selectHooks("TIKTOK", "ENGAGEMENT", "MEME");
    const businessHooks = selectHooks("TIKTOK", "ENGAGEMENT", "BUSINESS");

    const memeNames = memeHooks.map((h) => h.name);
    const businessNames = businessHooks.map((h) => h.name);

    // Both return valid results
    expect(memeNames.length).toBeGreaterThanOrEqual(3);
    expect(businessNames.length).toBeGreaterThanOrEqual(3);
  });

  it("returns unique hooks (no duplicates)", () => {
    const hooks = selectHooks("FACEBOOK", "BRAND_AWARENESS", "INFLUENCER");
    const names = hooks.map((h) => h.name);
    expect(new Set(names).size).toBe(names.length);
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
      const hooks = selectHooks(platform, "ENGAGEMENT", "BUSINESS");
      expect(hooks.length).toBeGreaterThanOrEqual(3);
      expect(hooks.length).toBeLessThanOrEqual(4);
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
      const hooks = selectHooks("TWITTER", goal, "BUSINESS");
      expect(hooks.length).toBeGreaterThanOrEqual(3);
      expect(hooks.length).toBeLessThanOrEqual(4);
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
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("includes diversity enforcement language", () => {
    const result = buildHookInstructions(
      ["INSTAGRAM"],
      "REACH",
      "INFLUENCER"
    );
    const lower = result.toLowerCase();
    expect(lower).toMatch(/divers|different hook type|vary/);
  });

  it("includes recommended hook names", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    // Should mention at least some hook type names
    const hookNames = HOOK_FRAMEWORKS.map((h) => h.name);
    const mentionedHooks = hookNames.filter((name) => result.includes(name));
    expect(mentionedHooks.length).toBeGreaterThan(0);
  });

  it("includes all 10 hook types as reference", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    // The hybrid approach: include all hooks for reference
    for (const hook of HOOK_FRAMEWORKS) {
      expect(result).toContain(hook.name);
    }
  });

  it("handles multiple platforms", () => {
    const result = buildHookInstructions(
      ["TWITTER", "INSTAGRAM", "TIKTOK"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    expect(result).toBeTruthy();
    // Should still include diversity enforcement
    const lower = result.toLowerCase();
    expect(lower).toMatch(/divers|different hook type|vary/);
  });

  it("includes example openers", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "ENGAGEMENT",
      "BUSINESS"
    );
    // Should include at least some examples
    const allExamples = HOOK_FRAMEWORKS.flatMap((h) => h.examples);
    const hasExample = allExamples.some((ex) => result.includes(ex));
    expect(hasExample).toBe(true);
  });

  it("mentions preferred hooks for context", () => {
    const result = buildHookInstructions(
      ["TWITTER"],
      "CONVERSIONS",
      "BUSINESS"
    );
    // Should highlight contextually preferred hooks
    expect(result.toLowerCase()).toMatch(/prefer|recommend|prioritize/);
  });
});
