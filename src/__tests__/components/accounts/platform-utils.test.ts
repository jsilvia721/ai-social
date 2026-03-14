import { PLATFORM_STYLES } from "@/components/accounts/platform-utils";

describe("PLATFORM_STYLES", () => {
  it("uses correct TikTok branding (capital T in Tok)", () => {
    expect(PLATFORM_STYLES.TIKTOK.label).toBe("TikTok");
  });

  it("uses correct YouTube branding (capital T)", () => {
    expect(PLATFORM_STYLES.YOUTUBE.label).toBe("YouTube");
  });

  it("has labels for all platforms", () => {
    const platforms = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;
    for (const p of platforms) {
      expect(PLATFORM_STYLES[p].label).toBeDefined();
      expect(PLATFORM_STYLES[p].label.length).toBeGreaterThan(0);
    }
  });
});
