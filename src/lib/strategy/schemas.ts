import { z } from "zod";
import { FormatMixSchema } from "@/lib/optimizer/schemas";

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

export const PostingCadenceSchema = z.record(
  z.string(),
  z.number().int().min(0).max(30)
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
    reviewWindowHours: z.number().int().min(1).max(168).optional(),
    postingCadence: PostingCadenceSchema.optional(),
    formatMix: FormatMixSchema.optional(),
    researchSources: ResearchSourcesSchema.optional(),
  })
  .strict();

export type StrategyPatch = z.infer<typeof StrategyPatchSchema>;
