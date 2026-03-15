import type { Platform } from "@/types";

/** Human-readable labels for each platform. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  TWITTER: "Twitter / X",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

/** Text-only color classes for inline platform names. */
export const PLATFORM_COLORS: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
  TIKTOK: "text-zinc-100",
  YOUTUBE: "text-red-500",
};

/** Badge-style color classes (background + text + border) for platform pills/tags. */
export const PLATFORM_BADGE_COLORS: Record<Platform, string> = {
  TWITTER: "bg-sky-400/10 text-sky-400 border-sky-400/20",
  INSTAGRAM: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  FACEBOOK: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  TIKTOK: "bg-zinc-100/10 text-zinc-100 border-zinc-100/20",
  YOUTUBE: "bg-red-500/10 text-red-500 border-red-500/20",
};
