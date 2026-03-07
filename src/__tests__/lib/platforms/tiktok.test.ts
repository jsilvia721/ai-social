import { publishTikTokVideo, refreshTikTokToken } from "@/lib/platforms/tiktok";

const originalEnv = process.env;

beforeEach(() => {
  jest.resetAllMocks();
  process.env = {
    ...originalEnv,
    TIKTOK_CLIENT_ID: "test-client-id",
    TIKTOK_CLIENT_SECRET: "test-client-secret",
  };
  jest.spyOn(global, "fetch").mockImplementation(() => {
    throw new Error("fetch not mocked");
  });
});

afterEach(() => {
  process.env = originalEnv;
});

describe("refreshTikTokToken", () => {
  it("exchanges refresh token and returns new tokens", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 86400,
      }),
    });

    const result = await refreshTikTokToken("old-refresh");

    expect(result.accessToken).toBe("new-access");
    expect(result.refreshToken).toBe("new-refresh");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("throws when refresh API returns an error", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: "invalid_grant" } }),
    });

    await expect(refreshTikTokToken("bad-refresh")).rejects.toThrow(
      "TikTok token refresh failed"
    );
  });
});

describe("publishTikTokVideo", () => {
  it("throws when no media URLs provided", async () => {
    await expect(publishTikTokVideo("token", "caption", [])).rejects.toThrow(
      "TikTok requires a video file"
    );
  });

  it("throws when media URL is not from internal storage (SSRF guard)", async () => {
    await expect(
      publishTikTokVideo("token", "caption", ["https://evil.com/video.mp4"])
    ).rejects.toThrow("SSRF guard");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("throws with clear message when API is not approved (scope error)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: "scope_not_authorized" } }),
    });

    await expect(
      publishTikTokVideo("token", "caption", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("TikTok Content Posting API access not yet approved");
  });

  it("throws with clear message when token is invalid (API pending)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: "access_token_invalid" } }),
    });

    await expect(
      publishTikTokVideo("token", "caption", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("TikTok Content Posting API access not yet approved");
  });

  it("throws on generic publish init failure", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: { code: "server_error" } }),
    });

    await expect(
      publishTikTokVideo("token", "caption", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("TikTok publish init failed");
  });

  it("throws when publish_id is missing from response", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: {} }), // no publish_id
    });

    await expect(
      publishTikTokVideo("token", "caption", ["https://storage.example.com/video.mp4"])
    ).rejects.toThrow("TikTok publish init did not return a publish_id");
  });

  it("returns publishId immediately after init succeeds (no polling)", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { publish_id: "pub-123" } }),
    });

    const result = await publishTikTokVideo("token", "caption", [
      "https://storage.example.com/video.mp4",
    ]);

    expect(result.id).toBe("pub-123");
    // Only one fetch — no status polling
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
