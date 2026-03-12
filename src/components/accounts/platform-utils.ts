import type { Platform } from "@/types";

export const PLATFORM_STYLES: Record<Platform, { color: string; bg: string; label: string }> = {
  TWITTER: { color: "text-sky-400", bg: "bg-sky-950/50 border-sky-800", label: "Twitter / X" },
  INSTAGRAM: { color: "text-pink-500", bg: "bg-pink-950/50 border-pink-800", label: "Instagram" },
  FACEBOOK: { color: "text-blue-500", bg: "bg-blue-950/50 border-blue-800", label: "Facebook" },
  TIKTOK: { color: "text-zinc-100", bg: "bg-zinc-950/80 border-zinc-600", label: "TikTok" },
  YOUTUBE: { color: "text-red-500", bg: "bg-red-950/50 border-red-800", label: "YouTube" },
};
