import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/platforms/twitter", () => ({ refreshTwitterToken: jest.fn() }));

import { ensureValidToken } from "@/lib/token";
import { refreshTwitterToken } from "@/lib/platforms/twitter";

const mockRefreshTwitterToken = refreshTwitterToken as jest.Mock;

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
      "Twitter token expired and no refresh token available"
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
});
