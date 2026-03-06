import { publishYouTubeVideo, refreshYouTubeToken } from "@/lib/platforms/youtube";

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    MINIO_PUBLIC_URL: "https://storage.example.com",
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

  it("throws when media URL is not from internal storage (SSRF guard)", async () => {
    await expect(
      publishYouTubeVideo("token", "desc", ["https://evil.com/video.mp4"])
    ).rejects.toThrow("Invalid media URL");
  });

  it("throws when video fetch from storage fails", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      headers: { get: () => null },
    });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("Failed to fetch video from storage");
  });

  it("throws when YouTube upload init fails", async () => {
    (global.fetch as jest.Mock)
      // Step 1: S3 fetch succeeds
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : null },
      })
      // Step 2: YouTube init fails
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "quota exceeded" } }),
        headers: { get: () => null },
      });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://storage.example.com/v.mp4"])
    ).rejects.toThrow("YouTube upload init failed");
  });

  it("throws when YouTube upload fails", async () => {
    (global.fetch as jest.Mock)
      // Step 1: S3 fetch
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : null },
      })
      // Step 2: YouTube init — returns upload URI
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (h: string) => h === "location" ? "https://upload.youtube.com/session/123" : null },
      })
      // Step 3: PUT to upload URI fails
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: { message: "quota exceeded" } }),
      });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://storage.example.com/v.mp4"])
    ).rejects.toThrow("YouTube upload failed");
  });

  it("throws when YouTube response is missing video ID", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (h: string) => h === "location" ? "https://upload.youtube.com/session/abc" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ kind: "youtube#video" }), // no id field
      });

    await expect(
      publishYouTubeVideo("token", "desc", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("YouTube upload response missing video ID");
  });

  it("publishes video and returns video ID and URL", async () => {
    (global.fetch as jest.Mock)
      // Step 1: S3 fetch
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : h === "content-length" ? "102400" : null },
      })
      // Step 2: YouTube resumable upload init
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (h: string) => h === "location" ? "https://upload.youtube.com/session/xyz" : null },
      })
      // Step 3: PUT upload
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-video-123" }),
      });

    const result = await publishYouTubeVideo(
      "access-token",
      "My Video\nDescription here",
      ["https://storage.example.com/video.mp4"]
    );

    expect(result.id).toBe("yt-video-123");
    expect(result.url).toBe("https://www.youtube.com/watch?v=yt-video-123");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("uses first line as title (truncated to 100 chars)", async () => {
    const longTitle = "A".repeat(150);
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (h: string) => h === "location" ? "https://upload.youtube.com/session/t" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-456" }),
      });

    await publishYouTubeVideo("token", longTitle, ["https://storage.example.com/v.mp4"]);

    // Call index 1 is the YouTube init POST with metadata JSON body
    const initCall = (global.fetch as jest.Mock).mock.calls[1];
    const bodyStr = initCall[1].body as string;
    expect(bodyStr).toContain(`"title":"${"A".repeat(100)}"`);
  });

  it("falls back to 'Untitled' when content is empty", async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        body: null,
        headers: { get: (h: string) => h === "content-type" ? "video/mp4" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: (h: string) => h === "location" ? "https://upload.youtube.com/session/u" : null },
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "yt-789" }),
      });

    await publishYouTubeVideo("token", "", ["https://storage.example.com/v.mp4"]);

    const initCall = (global.fetch as jest.Mock).mock.calls[1];
    const bodyStr = initCall[1].body as string;
    expect(bodyStr).toContain('"title":"Untitled"');
  });
});
