import {
  PLATFORM_LABELS,
  PLATFORM_COLORS,
  PLATFORM_BADGE_COLORS,
} from "@/lib/platforms";
import type { Platform } from "@/types";

const ALL_PLATFORMS: Platform[] = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];

describe("platforms", () => {
  describe("PLATFORM_LABELS", () => {
    it("has an entry for every Platform", () => {
      for (const p of ALL_PLATFORMS) {
        expect(PLATFORM_LABELS[p]).toBeDefined();
        expect(typeof PLATFORM_LABELS[p]).toBe("string");
        expect(PLATFORM_LABELS[p].length).toBeGreaterThan(0);
      }
    });

    it("uses human-readable names", () => {
      expect(PLATFORM_LABELS.TWITTER).toBe("Twitter / X");
      expect(PLATFORM_LABELS.INSTAGRAM).toBe("Instagram");
      expect(PLATFORM_LABELS.TIKTOK).toBe("TikTok");
    });
  });

  describe("PLATFORM_COLORS", () => {
    it("has a text color class for every Platform", () => {
      for (const p of ALL_PLATFORMS) {
        expect(PLATFORM_COLORS[p]).toBeDefined();
        expect(PLATFORM_COLORS[p]).toMatch(/^text-/);
      }
    });
  });

  describe("PLATFORM_BADGE_COLORS", () => {
    it("has badge classes (bg + text + border) for every Platform", () => {
      for (const p of ALL_PLATFORMS) {
        const classes = PLATFORM_BADGE_COLORS[p];
        expect(classes).toBeDefined();
        expect(classes).toContain("bg-");
        expect(classes).toContain("text-");
        expect(classes).toContain("border-");
      }
    });
  });
});
