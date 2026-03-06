import { publishYouTubeVideo, refreshYouTubeToken } from "@/lib/platforms/youtube";

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
  };
  jest.spyOn(global, "fetch").mockImplementation(() => {
    throw new Error("fetch not mocked");
  });
});

afterEach(() => {
  process.env = originalEnv;
});

describe("refreshYouTubeToken", () => {
  it("refreshes access token using Google refresh token", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        expires_in: 3600,
      }),
    });

    const result = await refreshYouTubeToken("old-refresh");

    expect(result.accessToken).toBe("new-access");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("uses default 3600s expiry when expires_in missing", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "new-access" }),
    });

    const before = Date.now();
    const result = await refreshYouTubeToken("refresh");
    const after = Date.now();

    // expiresAt should be ~3600 seconds from now
    expect(result.expiresAt.getTime()).toBeGreaterThan(before + 3590 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThan(after + 3601 * 1000);
  });

  it("throws when Google token refresh fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });

    await expect(refreshYouTubeToken("bad-refresh")).rejects.toThrow(
      "YouTube token refresh failed"
    );
  });
});

describe("publishYouTubeVideo", () => {
  it("throws when no media URLs provided", async () => {
    await expect(publishYouTubeVideo("token", "desc", [])).rejects.toThrow(
      "YouTube requires a video file"
    );
  });

  it("throws when video fetch from storage fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      headers: { get: () => null },
    });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://s3.example.com/video.mp4"])
    ).rejects.toThrow("Failed to fetch video from storage");
  });

  it("publishes video and returns video ID and URL", async () => {
    // First fetch: download video from storage
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
        headers: { get: () => "video/mp4" },
      })
      // Second fetch: YouTube upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-video-123" }),
      });

    const result = await publishYouTubeVideo(
      "access-token",
      "My Video\nDescription here",
      ["https://s3.example.com/video.mp4"]
    );

    expect(result.id).toBe("yt-video-123");
    expect(result.url).toBe("https://www.youtube.com/watch?v=yt-video-123");
  });

  it("uses first line as title (truncated to 100 chars)", async () => {
    const longTitle = "A".repeat(150);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "video/mp4" },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-456" }),
      });

    await publishYouTubeVideo("token", longTitle, ["https://example.com/v.mp4"]);

    const uploadCall = (global.fetch as jest.Mock).mock.calls[1];
    const bodyStr = uploadCall[1].body.toString();
    expect(bodyStr).toContain(`"title":"${"A".repeat(100)}"`);
  });

  it("falls back to 'Untitled' when description is empty", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "video/mp4" },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-789" }),
      });

    await publishYouTubeVideo("token", "", ["https://example.com/v.mp4"]);

    const uploadCall = (global.fetch as jest.Mock).mock.calls[1];
    const bodyStr = uploadCall[1].body.toString();
    expect(bodyStr).toContain('"title":"Untitled"');
  });

  it("throws when YouTube upload fails", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: { get: () => "video/mp4" },
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "quota exceeded" } }),
      });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://example.com/v.mp4"])
    ).rejects.toThrow("YouTube upload failed");
  });
});
