import type { Platform } from "@/types";
import { PLATFORM_LABELS, PLATFORM_COLORS } from "@/lib/platforms";

export const PLATFORM_STYLES: Record<Platform, { color: string; bg: string; label: string }> = {
  TWITTER: { color: PLATFORM_COLORS.TWITTER, bg: "bg-sky-950/50 border-sky-800", label: PLATFORM_LABELS.TWITTER },
  INSTAGRAM: { color: PLATFORM_COLORS.INSTAGRAM, bg: "bg-pink-950/50 border-pink-800", label: PLATFORM_LABELS.INSTAGRAM },
  FACEBOOK: { color: PLATFORM_COLORS.FACEBOOK, bg: "bg-blue-950/50 border-blue-800", label: PLATFORM_LABELS.FACEBOOK },
  TIKTOK: { color: PLATFORM_COLORS.TIKTOK, bg: "bg-zinc-950/80 border-zinc-600", label: PLATFORM_LABELS.TIKTOK },
  YOUTUBE: { color: PLATFORM_COLORS.YOUTUBE, bg: "bg-red-950/50 border-red-800", label: PLATFORM_LABELS.YOUTUBE },
};
