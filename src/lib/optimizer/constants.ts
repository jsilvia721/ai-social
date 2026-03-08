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

/** Engagement weight factors */
export const ENGAGEMENT_WEIGHTS = {
  likes: 1,
  comments: 3,
  shares: 5,
  saves: 4,
} as const;
