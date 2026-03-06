import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { refreshTwitterToken } from "@/lib/platforms/twitter";
import { refreshYouTubeToken } from "@/lib/platforms/youtube";
import { refreshTikTokToken } from "@/lib/platforms/tiktok";
import { encryptToken, decryptToken } from "@/lib/crypto";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export async function ensureValidToken(account: SocialAccount): Promise<string> {
  const { expiresAt, platform, updatedAt } = account;
  const accessToken = decryptToken(account.accessToken);
  const refreshToken = account.refreshToken ? decryptToken(account.refreshToken) : null;

  // No expiry set, or token is valid for more than 5 minutes — return as-is
  if (!expiresAt || expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return accessToken;
  }

  // Meta Page Access Tokens never expire
  if (platform === "INSTAGRAM" || platform === "FACEBOOK") {
    return accessToken;
  }

  if (!refreshToken) {
    throw new Error(`${platform} token expired and no refresh token available`);
  }

  let newTokenData: { accessToken: string; refreshToken?: string; expiresAt: Date };

  if (platform === "TWITTER") {
    const result = await refreshTwitterToken(refreshToken);
    newTokenData = result;
  } else if (platform === "YOUTUBE") {
    // Google refresh tokens don't rotate — only access token changes
    const result = await refreshYouTubeToken(refreshToken);
    newTokenData = result;
  } else if (platform === "TIKTOK") {
    const result = await refreshTikTokToken(refreshToken);
    newTokenData = result;
  } else {
    throw new Error(`Token refresh not supported for platform: ${platform}`);
  }

  // Optimistic CAS: only update if no other process refreshed this account concurrently.
  // If two refreshes race, the second updateMany returns count=0 — we then re-read the
  // already-refreshed token rather than overwriting it with a stale one.
  const updated = await prisma.socialAccount.updateMany({
    where: { id: account.id, updatedAt },
    data: {
      accessToken: encryptToken(newTokenData.accessToken),
      ...(newTokenData.refreshToken !== undefined && {
        refreshToken: newTokenData.refreshToken ? encryptToken(newTokenData.refreshToken) : null,
      }),
      expiresAt: newTokenData.expiresAt,
    },
  });

  if (updated.count === 0) {
    // Another concurrent refresh already wrote a fresh token — read and return it.
    const fresh = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    return decryptToken(fresh.accessToken);
  }

  return newTokenData.accessToken;
}
