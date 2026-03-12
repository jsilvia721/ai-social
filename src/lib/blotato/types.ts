import { z } from "zod";
import type { Platform } from "@prisma/client";

export const BlotatoAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  fullname: z.string().optional(),
  username: z.string(),
});

export const BlotatoPublishResultSchema = z.object({
  postSubmissionId: z.string(),
});

export const BlotatoPostMetricsSchema = z.object({
  likes: z.number().default(0),
  comments: z.number().default(0),
  shares: z.number().default(0),
  impressions: z.number().default(0),
  reach: z.number().default(0),
  saves: z.number().default(0),
});

export type BlotatoAccount = z.infer<typeof BlotatoAccountSchema>;
export type BlotatoPublishResult = z.infer<typeof BlotatoPublishResultSchema>;
export type BlotatoPostMetrics = z.infer<typeof BlotatoPostMetricsSchema>;

// ── Platform name mapping ───────────────────────────────────────────────────
// Blotato uses lowercase platform names ("twitter"), Prisma uses uppercase ("TWITTER")

const BLOTATO_TO_PRISMA: Record<string, Platform> = {
  twitter: "TWITTER",
  instagram: "INSTAGRAM",
  facebook: "FACEBOOK",
  tiktok: "TIKTOK",
  youtube: "YOUTUBE",
};

/** Convert a Blotato platform name (lowercase) to our Prisma Platform enum (uppercase). */
export function toPrismaPlatform(blotatoPlatform: string): Platform | null {
  return BLOTATO_TO_PRISMA[blotatoPlatform.toLowerCase()] ?? null;
}

/** Convert our Prisma Platform enum (uppercase) to a Blotato platform name (lowercase). */
export function toBlotatoPlatform(platform: Platform): string {
  return platform.toLowerCase();
}
