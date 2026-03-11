import { z } from "zod";

// ── Wizard Validation ────────────────────────────────────────────────────────
// Keys match the onboarding wizard step keys in businesses/[id]/onboard/page.tsx
// Claude maps these to ContentStrategy model fields during extraction.

export const WizardAnswersSchema = z
  .object({
    businessType: z.string().min(1).max(500),
    targetAudience: z.string().min(1).max(1000),
    tonePreference: z.string().min(1).max(500),
    primaryGoal: z.string().min(1).max(500),
    competitors: z.string().max(500).optional().default(""),
  })
  .strict();

export type WizardAnswers = z.infer<typeof WizardAnswersSchema>;

// ── Strategy PATCH Validation ────────────────────────────────────────────────

// Posting cadence: number = manual posts/week, null = AI-optimized
export const PostingCadenceSchema = z.record(
  z.string(),
  z.number().int().min(0).max(30).nullable()
);

export const ResearchSourcesSchema = z.object({
  rssFeeds: z
    .array(
      z
        .string()
        .url()
        .refine((url) => url.startsWith("https://"), {
          message: "RSS feeds must use HTTPS",
        })
    )
    .default([]),
  subreddits: z
    .array(
      z.string().regex(/^[a-zA-Z0-9_]+$/, "Invalid subreddit name")
    )
    .default([]),
});

export type ResearchSources = z.infer<typeof ResearchSourcesSchema>;

// Per-platform format mix: inner record maps format→weight (integer 1-10).
// null value for a platform = AI-optimized.
// Weights are relative; the UI auto-calculates percentages.
const FormatWeightsSchema = z.record(
  z.string(),
  z.number().int().min(0).max(10)
);

export const PlatformFormatMixSchema = z.record(
  z.string(),
  FormatWeightsSchema.nullable()
);

// Valid formats per platform
export const PLATFORM_FORMATS: Record<string, readonly string[]> = {
  TWITTER: ["TEXT", "IMAGE"],
  INSTAGRAM: ["IMAGE", "CAROUSEL", "VIDEO"],
  FACEBOOK: ["TEXT", "IMAGE", "VIDEO"],
  TIKTOK: ["VIDEO"],
  YOUTUBE: ["VIDEO"],
};

/**
 * Flatten per-platform format mix to a global format mix (ratios 0-1).
 * Used by optimizer and brief generator for backwards compatibility.
 * If already flat (old format), returns as-is.
 */
export function flattenFormatMix(
  formatMix: Record<string, unknown> | null | undefined
): Record<string, number> | null {
  if (!formatMix || typeof formatMix !== "object") return null;

  const firstValue = Object.values(formatMix)[0];

  // Already flat (old format): { TEXT: 0.3, IMAGE: 0.7 }
  if (typeof firstValue === "number") {
    return formatMix as Record<string, number>;
  }

  // Per-platform format: { TWITTER: { TEXT: 3, IMAGE: 2 }, ... }
  // Convert weights to ratios and average across platforms
  const totals: Record<string, number[]> = {};
  for (const platformMix of Object.values(formatMix)) {
    if (platformMix && typeof platformMix === "object") {
      const weights = platformMix as Record<string, number>;
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      if (sum === 0) continue;
      for (const [format, weight] of Object.entries(weights)) {
        if (!totals[format]) totals[format] = [];
        totals[format].push(weight / sum);
      }
    }
  }

  const flat: Record<string, number> = {};
  for (const [format, values] of Object.entries(totals)) {
    flat[format] = values.reduce((a, b) => a + b, 0) / values.length;
  }
  return Object.keys(flat).length > 0 ? flat : null;
}

export const StrategyPatchSchema = z
  .object({
    updatedAt: z.string().datetime(),
    industry: z.string().min(1).max(200).optional(),
    targetAudience: z.string().min(1).max(1000).optional(),
    contentPillars: z
      .array(z.string().min(1).max(100))
      .min(1)
      .max(10)
      .optional(),
    brandVoice: z.string().min(1).max(2000).optional(),
    optimizationGoal: z
      .enum(["ENGAGEMENT", "REACH", "CONVERSIONS", "BRAND_AWARENESS"])
      .optional(),
    reviewWindowEnabled: z.boolean().optional(),
    reviewWindowHours: z.number().int().min(0).max(168).optional(),
    postingCadence: PostingCadenceSchema.optional(),
    formatMix: PlatformFormatMixSchema.optional(),
    researchSources: ResearchSourcesSchema.optional(),
    accountType: z.enum(["BUSINESS", "INFLUENCER", "MEME"]).optional(),
    visualStyle: z.string().max(500).nullable().optional(),
  })
  .strict();

export type StrategyPatch = z.infer<typeof StrategyPatchSchema>;
