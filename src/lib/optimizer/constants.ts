import type { Platform } from "@/types";

/** Hours after publish before engagement metrics are considered mature per platform */
export const METRICS_MATURE_HOURS: Record<Platform, number> = {
  TWITTER: 24,
  FACEBOOK: 24,
  INSTAGRAM: 72,
  TIKTOK: 72,
  YOUTUBE: 168,
};

/** Baseline engagement per post for normalization (conservative estimates) */
export const PLATFORM_BASELINES: Record<
  Platform,
  { likes: number; comments: number; shares: number; saves: number }
> = {
  TWITTER: { likes: 50, comments: 10, shares: 15, saves: 5 },
  INSTAGRAM: { likes: 200, comments: 30, shares: 20, saves: 40 },
  FACEBOOK: { likes: 100, comments: 20, shares: 25, saves: 10 },
  TIKTOK: { likes: 500, comments: 50, shares: 100, saves: 80 },
  YOUTUBE: { likes: 100, comments: 30, shares: 10, saves: 20 },
};

/** Default engagement weight factors (fallback for unknown platforms) */
export const ENGAGEMENT_WEIGHTS = {
  likes: 1,
  comments: 3,
  shares: 5,
  saves: 4,
} as const;

/** Per-platform engagement weights based on algorithm signals.
 *  Raw industry numbers — higher weight = stronger algorithm signal.
 *  "shares" maps to whatever Blotato returns for metricsShares
 *  (Twitter=retweets, Instagram=sends, etc.)
 */
export const PLATFORM_ENGAGEMENT_WEIGHTS: Record<
  Platform,
  { likes: number; comments: number; shares: number; saves: number }
> = {
  TWITTER: { likes: 1, comments: 13.5, shares: 20, saves: 10 },
  INSTAGRAM: { likes: 1, comments: 5, shares: 3, saves: 10 },
  TIKTOK: { likes: 1, comments: 5, shares: 8, saves: 6 },
  FACEBOOK: { likes: 1, comments: 3, shares: 5, saves: 4 },
  YOUTUBE: { likes: 1, comments: 5, shares: 4, saves: 3 },
};
