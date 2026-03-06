import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/platforms/twitter", () => ({ refreshTwitterToken: jest.fn() }));
jest.mock("@/lib/platforms/youtube", () => ({ refreshYouTubeToken: jest.fn() }));
jest.mock("@/lib/platforms/tiktok", () => ({ refreshTikTokToken: jest.fn() }));

import { ensureValidToken } from "@/lib/token";
import { refreshTwitterToken } from "@/lib/platforms/twitter";
import { refreshYouTubeToken } from "@/lib/platforms/youtube";
import { refreshTikTokToken } from "@/lib/platforms/tiktok";

const mockRefreshTwitterToken = refreshTwitterToken as jest.Mock;
const mockRefreshYouTubeToken = refreshYouTubeToken as jest.Mock;
const mockRefreshTikTokToken = refreshTikTokToken as jest.Mock;

function makeAccount(overrides: object) {
  return {
    id: "acct-1",
    userId: "user-1",
    platform: "TWITTER" as const,
    platformId: "tw-123",
    username: "testuser",
    accessToken: "existing-token",
    refreshToken: "existing-refresh-token",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

// Helper to make a social account for any platform
function makeAccountForPlatform(platform: string, overrides: object = {}) {
  return {
    id: "acct-1",
    userId: "user-1",
    platform: platform as any,
    platformId: "id-123",
    username: "testuser",
    accessToken: "existing-token",
    refreshToken: "existing-refresh-token",
    expiresAt: new Date(Date.now() - 1000), // expired
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("ensureValidToken", () => {
  it("returns existing token when not expired (more than 5 min remaining)", async () => {
    const account = makeAccount({});
    const token = await ensureValidToken(account);
    expect(token).toBe("existing-token");
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled();
  });

  it("returns existing token when expiresAt is null", async () => {
    const account = makeAccount({ expiresAt: null });
    const token = await ensureValidToken(account);
    expect(token).toBe("existing-token");
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
  });

  it("refreshes expired Twitter token, updates DB, and returns new token", async () => {
    const expiredAt = new Date(Date.now() - 1000); // 1 second ago
    const account = makeAccount({ expiresAt: expiredAt });

    const newExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000);
    mockRefreshTwitterToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      expiresAt: newExpiry,
    });
    prismaMock.socialAccount.update.mockResolvedValue({} as any);

    const token = await ensureValidToken(account);

    expect(mockRefreshTwitterToken).toHaveBeenCalledWith("existing-refresh-token");
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: "acct-1" },
      data: {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresAt: newExpiry,
      },
    });
    expect(token).toBe("new-access-token");
  });

  it("refreshes token expiring within 5 minute buffer window", async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now
    const account = makeAccount({ expiresAt: nearExpiry });

    mockRefreshTwitterToken.mockResolvedValue({
      accessToken: "refreshed-token",
      refreshToken: "new-refresh-token",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
    prismaMock.socialAccount.update.mockResolvedValue({} as any);

    const token = await ensureValidToken(account);

    expect(mockRefreshTwitterToken).toHaveBeenCalled();
    expect(token).toBe("refreshed-token");
  });

  it("throws when Twitter token is expired but no refreshToken stored", async () => {
    const account = makeAccount({
      expiresAt: new Date(Date.now() - 1000),
      refreshToken: null,
    });

    await expect(ensureValidToken(account)).rejects.toThrow(
      "TWITTER token expired and no refresh token available"
    );
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
  });

  it("throws when Twitter refresh API returns an error", async () => {
    const account = makeAccount({ expiresAt: new Date(Date.now() - 1000) });
    mockRefreshTwitterToken.mockRejectedValue(
      new Error("Twitter token refresh failed: {\"error\":\"invalid_grant\"}")
    );

    await expect(ensureValidToken(account)).rejects.toThrow(
      "Twitter token refresh failed"
    );
  });

  it("returns existing token for INSTAGRAM account with null expiresAt", async () => {
    const account = makeAccount({
      platform: "INSTAGRAM" as const,
      expiresAt: null,
    });
    const token = await ensureValidToken(account);
    expect(token).toBe("existing-token");
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
  });

  it("returns existing token for INSTAGRAM account even when expiresAt is in the past", async () => {
    const account = makeAccount({
      platform: "INSTAGRAM" as const,
      expiresAt: new Date(Date.now() - 1000),
    });
    const token = await ensureValidToken(account);
    expect(token).toBe("existing-token");
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
  });

  it("returns existing token for FACEBOOK account with null expiresAt", async () => {
    const account = makeAccount({
      platform: "FACEBOOK" as const,
      expiresAt: null,
    });
    const token = await ensureValidToken(account);
    expect(token).toBe("existing-token");
    expect(mockRefreshTwitterToken).not.toHaveBeenCalled();
  });

  describe("YouTube token refresh", () => {
    it("refreshes expired YouTube token, updates DB (no refreshToken rotation), returns new token", async () => {
      const account = makeAccountForPlatform("YOUTUBE");
      const newExpiry = new Date(Date.now() + 3600 * 1000);
      mockRefreshYouTubeToken.mockResolvedValue({
        accessToken: "new-youtube-token",
        expiresAt: newExpiry,
      });
      prismaMock.socialAccount.update.mockResolvedValue({} as any);

      const token = await ensureValidToken(account);

      expect(mockRefreshYouTubeToken).toHaveBeenCalledWith("existing-refresh-token");
      expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
        where: { id: "acct-1" },
        data: { accessToken: "new-youtube-token", expiresAt: newExpiry },
      });
      expect(token).toBe("new-youtube-token");
    });

    it("throws when YouTube token is expired and no refreshToken", async () => {
      const account = makeAccountForPlatform("YOUTUBE", { refreshToken: null });
      await expect(ensureValidToken(account)).rejects.toThrow(
        "YOUTUBE token expired and no refresh token available"
      );
      expect(mockRefreshYouTubeToken).not.toHaveBeenCalled();
    });

    it("returns YOUTUBE token when not expired", async () => {
      const account = makeAccountForPlatform("YOUTUBE", {
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const token = await ensureValidToken(account);
      expect(token).toBe("existing-token");
      expect(mockRefreshYouTubeToken).not.toHaveBeenCalled();
    });
  });

  describe("TikTok token refresh", () => {
    it("refreshes expired TikTok token, updates DB with rotated tokens", async () => {
      const account = makeAccountForPlatform("TIKTOK");
      const newExpiry = new Date(Date.now() + 86400 * 1000);
      mockRefreshTikTokToken.mockResolvedValue({
        accessToken: "new-tiktok-token",
        refreshToken: "new-tiktok-refresh",
        expiresAt: newExpiry,
      });
      prismaMock.socialAccount.update.mockResolvedValue({} as any);

      const token = await ensureValidToken(account);

      expect(mockRefreshTikTokToken).toHaveBeenCalledWith("existing-refresh-token");
      expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
        where: { id: "acct-1" },
        data: {
          accessToken: "new-tiktok-token",
          refreshToken: "new-tiktok-refresh",
          expiresAt: newExpiry,
        },
      });
      expect(token).toBe("new-tiktok-token");
    });

    it("throws when TikTok token is expired and no refreshToken", async () => {
      const account = makeAccountForPlatform("TIKTOK", { refreshToken: null });
      await expect(ensureValidToken(account)).rejects.toThrow(
        "TIKTOK token expired and no refresh token available"
      );
      expect(mockRefreshTikTokToken).not.toHaveBeenCalled();
    });
  });
});
