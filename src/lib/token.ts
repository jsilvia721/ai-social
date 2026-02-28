import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { refreshTwitterToken } from "@/lib/platforms/twitter";

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export async function ensureValidToken(account: SocialAccount): Promise<string> {
  const { expiresAt, platform, accessToken, refreshToken } = account;

  // No expiry set, or token is valid for more than 5 minutes — return as-is
  if (!expiresAt || expiresAt.getTime() - Date.now() > REFRESH_BUFFER_MS) {
    return accessToken;
  }

  // Meta Page Access Tokens never expire
  if (platform === "INSTAGRAM" || platform === "FACEBOOK") {
    return accessToken;
  }

  // Twitter: attempt refresh
  if (!refreshToken) {
    throw new Error("Twitter token expired and no refresh token available");
  }

  const newTokenData = await refreshTwitterToken(refreshToken);

  await prisma.socialAccount.update({
    where: { id: account.id },
    data: {
      accessToken: newTokenData.accessToken,
      refreshToken: newTokenData.refreshToken,
      expiresAt: newTokenData.expiresAt,
    },
  });

  return newTokenData.accessToken;
}
