import { z } from "zod";

// ── Format Mix ──────────────────────────────────────────────────────────────

export const FormatMixSchema = z.record(
  z.string(), // BriefFormat keys: "TEXT" | "IMAGE" | "CAROUSEL" | "VIDEO"
  z.number().min(0).max(1)
);

export type FormatMix = z.infer<typeof FormatMixSchema>;

// ── Time Windows ────────────────────────────────────────────────────────────

export const TimeWindowsSchema = z.record(
  z.string(), // Platform keys
  z.array(z.string()) // e.g. ["09:00-11:00", "17:00-19:00"]
);

export type TimeWindows = z.infer<typeof TimeWindowsSchema>;

// ── Performance Analysis (Claude response) ──────────────────────────────────

export const PerformanceAnalysisSchema = z.object({
  patterns: z.array(z.string()).max(5),
  formatMixChanges: z
    .record(z.string(), z.number().min(-0.2).max(0.2))
    .optional(),
  cadenceChanges: z
    .record(z.string(), z.number().int().min(-2).max(2))
    .optional(),
  topicInsights: z.array(z.string()).optional(),
  digest: z.string().max(2000),
});

export type PerformanceAnalysis = z.infer<typeof PerformanceAnalysisSchema>;

// ── Strategy Digest stored fields ───────────────────────────────────────────

export const DigestPatternsSchema = z.object({
  topPerformers: z.array(
    z.object({
      postId: z.string(),
      score: z.number(),
      format: z.string().nullable(),
      topicPillar: z.string().nullable(),
    })
  ),
  insights: z.array(z.string()),
});

export type DigestPatterns = z.infer<typeof DigestPatternsSchema>;

export const DigestChangesSchema = z.object({
  formatMix: z.record(z.string(), z.number()).optional(),
  cadence: z.record(z.string(), z.number()).optional(),
  topicInsights: z.array(z.string()).optional(),
});

export type DigestChanges = z.infer<typeof DigestChangesSchema>;
