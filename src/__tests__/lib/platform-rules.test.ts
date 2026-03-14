import {
  MEDIA_REQUIRED_PLATFORMS,
  requiresMedia,
  assertMediaForPlatform,
} from "@/lib/platform-rules";

describe("platform-rules", () => {
  describe("MEDIA_REQUIRED_PLATFORMS", () => {
    it("includes INSTAGRAM and TIKTOK", () => {
      expect(MEDIA_REQUIRED_PLATFORMS.has("INSTAGRAM")).toBe(true);
      expect(MEDIA_REQUIRED_PLATFORMS.has("TIKTOK")).toBe(true);
    });

    it("does not include TWITTER, FACEBOOK, or YOUTUBE", () => {
      expect(MEDIA_REQUIRED_PLATFORMS.has("TWITTER")).toBe(false);
      expect(MEDIA_REQUIRED_PLATFORMS.has("FACEBOOK")).toBe(false);
      expect(MEDIA_REQUIRED_PLATFORMS.has("YOUTUBE")).toBe(false);
    });
  });

  describe("requiresMedia", () => {
    it("returns true for INSTAGRAM", () => {
      expect(requiresMedia("INSTAGRAM")).toBe(true);
    });

    it("returns true for TIKTOK", () => {
      expect(requiresMedia("TIKTOK")).toBe(true);
    });

    it("returns false for TWITTER", () => {
      expect(requiresMedia("TWITTER")).toBe(false);
    });

    it("returns false for FACEBOOK", () => {
      expect(requiresMedia("FACEBOOK")).toBe(false);
    });

    it("returns false for YOUTUBE", () => {
      expect(requiresMedia("YOUTUBE")).toBe(false);
    });
  });

  describe("assertMediaForPlatform", () => {
    it("does not throw when media is provided for INSTAGRAM", () => {
      expect(() =>
        assertMediaForPlatform("INSTAGRAM", ["https://example.com/image.jpg"])
      ).not.toThrow();
    });

    it("does not throw when media is provided for TIKTOK", () => {
      expect(() =>
        assertMediaForPlatform("TIKTOK", ["https://example.com/video.mp4"])
      ).not.toThrow();
    });

    it("throws when media is missing for INSTAGRAM", () => {
      expect(() => assertMediaForPlatform("INSTAGRAM", [])).toThrow(
        "INSTAGRAM requires at least one image or video"
      );
    });

    it("throws when media is missing for TIKTOK", () => {
      expect(() => assertMediaForPlatform("TIKTOK", [])).toThrow(
        "TIKTOK requires at least one image or video"
      );
    });

    it("does not throw when media is missing for TWITTER", () => {
      expect(() => assertMediaForPlatform("TWITTER", [])).not.toThrow();
    });

    it("does not throw when media is missing for FACEBOOK", () => {
      expect(() => assertMediaForPlatform("FACEBOOK", [])).not.toThrow();
    });

    it("does not throw when media is missing for YOUTUBE", () => {
      expect(() => assertMediaForPlatform("YOUTUBE", [])).not.toThrow();
    });
  });
});
