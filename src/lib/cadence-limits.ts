/**
 * Growth-aware cadence enforcement.
 *
 * Caps weekly posting cadence per platform based on platform intelligence
 * data to prevent over-posting that triggers spam detection algorithms.
 */

import { PLATFORM_INTELLIGENCE } from "@/lib/ai/knowledge/platform-intelligence";
import type { Platform } from "@/types";

export const DAYS_PER_WEEK = 7;

const KNOWN_PLATFORMS = new Set<string>(Object.keys(PLATFORM_INTELLIGENCE));

/**
 * Returns the maximum daily posts for a platform.
 *
 * Uses growth stage thresholds when follower count is provided.
 * Falls back to conservative defaults (lower tier) when no follower count available.
 */
export function getMaxDailyPosts(
  platform: Platform,
  followerCount?: number,
): number {
  const intel = PLATFORM_INTELLIGENCE[platform];

  // If growth stage thresholds exist and follower count provided, find matching stage
  if (followerCount != null && intel.cadence.byGrowthStage) {
    for (const stage of intel.cadence.byGrowthStage) {
      const aboveMin =
        stage.minFollowers == null || followerCount >= stage.minFollowers;
      const belowMax =
        stage.maxFollowers == null || followerCount < stage.maxFollowers;
      if (aboveMin && belowMax) {
        return stage.postsPerDay;
      }
    }
  }

  // Conservative default: use the lowest growth stage if available,
  // otherwise fall back to the flat maxPerDay
  if (intel.cadence.byGrowthStage && intel.cadence.byGrowthStage.length > 0) {
    return intel.cadence.byGrowthStage[0].postsPerDay;
  }

  return intel.cadence.maxPerDay;
}

/**
 * Clamps weekly cadence values to platform-specific maximum weekly limits.
 *
 * @param cadencePerPlatform - Weekly post counts per platform
 * @param overrideEnabled - If true, allow user-set cadence to exceed limits (with warning)
 * @param followerCount - Optional follower count for growth-stage-aware limits
 * @returns Clamped cadence object (same shape as input)
 */
export function clampCadence(
  cadencePerPlatform: Record<string, number>,
  overrideEnabled?: boolean,
  followerCount?: number,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [platform, weeklyCount] of Object.entries(cadencePerPlatform)) {
    // Pass through unknown platforms
    if (!KNOWN_PLATFORMS.has(platform)) {
      result[platform] = weeklyCount;
      continue;
    }

    const maxDaily = getMaxDailyPosts(platform as Platform, followerCount);
    const maxWeekly = maxDaily * DAYS_PER_WEEK;

    if (weeklyCount > maxWeekly) {
      if (overrideEnabled) {
        console.warn(
          `Cadence override: ${platform} set to ${weeklyCount}/week exceeds recommended max of ${maxWeekly}/week (${maxDaily}/day). Allowing due to user override.`,
        );
        result[platform] = weeklyCount;
      } else {
        result[platform] = maxWeekly;
      }
    } else {
      result[platform] = weeklyCount;
    }
  }

  return result;
}
