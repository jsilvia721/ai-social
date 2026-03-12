import { isVideoUrl, isVideoFile, VIDEO_EXTENSIONS } from "@/lib/media";

describe("VIDEO_EXTENSIONS", () => {
  it("contains mp4, mov, and webm", () => {
    expect(VIDEO_EXTENSIONS).toEqual(new Set([".mp4", ".mov", ".webm"]));
  });
});

describe("isVideoUrl", () => {
  it("returns true for .mp4 URLs", () => {
    expect(isVideoUrl("https://example.com/video.mp4")).toBe(true);
  });

  it("returns true for .mov URLs", () => {
    expect(isVideoUrl("https://example.com/video.mov")).toBe(true);
  });

  it("returns true for .webm URLs", () => {
    expect(isVideoUrl("https://example.com/video.webm")).toBe(true);
  });

  it("returns false for .jpg URLs", () => {
    expect(isVideoUrl("https://example.com/photo.jpg")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isVideoUrl("")).toBe(false);
  });

  it("handles URLs with query params", () => {
    expect(isVideoUrl("https://example.com/video.mp4?token=abc123")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isVideoUrl("https://example.com/video.MP4")).toBe(true);
    expect(isVideoUrl("https://example.com/video.WebM")).toBe(true);
  });

  it("returns false for .png URLs", () => {
    expect(isVideoUrl("https://example.com/image.png")).toBe(false);
  });
});

describe("isVideoFile", () => {
  it("returns true for video/* mime types", () => {
    const file = new File([""], "test.mp4", { type: "video/mp4" });
    expect(isVideoFile(file)).toBe(true);
  });

  it("returns false for image/* mime types", () => {
    const file = new File([""], "test.jpg", { type: "image/jpeg" });
    expect(isVideoFile(file)).toBe(false);
  });

  it("returns true for video/quicktime (mov)", () => {
    const file = new File([""], "test.mov", { type: "video/quicktime" });
    expect(isVideoFile(file)).toBe(true);
  });
});
