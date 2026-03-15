import {
  VIDEO_MODEL_DEFAULT,
  VIDEO_DURATION_DEFAULT,
  VIDEO_PROMPT_MAX_LENGTH,
  PLATFORM_VIDEO_ASPECT_RATIO,
} from "@/lib/video";

describe("video constants", () => {
  it("exports the default video model", () => {
    expect(VIDEO_MODEL_DEFAULT).toBe("kwaivgi/kling-v3-omni-video");
  });

  it("exports default video duration", () => {
    expect(VIDEO_DURATION_DEFAULT).toBe(5);
  });

  it("exports max prompt length", () => {
    expect(VIDEO_PROMPT_MAX_LENGTH).toBe(2500);
  });

  describe("PLATFORM_VIDEO_ASPECT_RATIO", () => {
    it("maps TIKTOK to 9:16", () => {
      expect(PLATFORM_VIDEO_ASPECT_RATIO.TIKTOK).toBe("9:16");
    });

    it("maps INSTAGRAM to 9:16", () => {
      expect(PLATFORM_VIDEO_ASPECT_RATIO.INSTAGRAM).toBe("9:16");
    });

    it("maps YOUTUBE to 16:9", () => {
      expect(PLATFORM_VIDEO_ASPECT_RATIO.YOUTUBE).toBe("16:9");
    });

    it("maps FACEBOOK to 16:9", () => {
      expect(PLATFORM_VIDEO_ASPECT_RATIO.FACEBOOK).toBe("16:9");
    });

    it("maps TWITTER to 16:9", () => {
      expect(PLATFORM_VIDEO_ASPECT_RATIO.TWITTER).toBe("16:9");
    });

    it("covers all 5 platforms", () => {
      const platforms = Object.keys(PLATFORM_VIDEO_ASPECT_RATIO);
      expect(platforms).toHaveLength(5);
      expect(platforms).toEqual(
        expect.arrayContaining(["TIKTOK", "INSTAGRAM", "YOUTUBE", "FACEBOOK", "TWITTER"])
      );
    });
  });
});
