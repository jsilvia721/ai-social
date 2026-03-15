import type { Platform } from "@prisma/client";

/** Platforms that require at least one media attachment to publish. */
export const MEDIA_REQUIRED_PLATFORMS = new Set<Platform>(["INSTAGRAM", "TIKTOK", "YOUTUBE"]);

/** Returns true if the given platform requires media attachments. */
export function requiresMedia(platform: Platform): boolean {
  return MEDIA_REQUIRED_PLATFORMS.has(platform);
}

/**
 * Throws a descriptive error if media is required for the platform but none provided.
 * No-op for platforms that allow text-only posts.
 */
export function assertMediaForPlatform(platform: Platform, mediaUrls: string[]): void {
  if (requiresMedia(platform) && mediaUrls.length === 0) {
    throw new Error(`${platform} requires at least one image or video`);
  }
}
