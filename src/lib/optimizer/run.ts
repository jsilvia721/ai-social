/**
 * Weekly Strategy Optimizer — invoked by AWS EventBridge Lambda every Sunday 2am UTC.
 *
 * For each active business with sufficient performance data:
 *   1. Fetch last 30 days of published posts with mature metrics
 *   2. Compute engagement rates and format mix
 *   3. Call Claude to analyze patterns and suggest strategy changes
 *   4. Apply changes within guardrails
 *   5. Create StrategyDigest record
 */
import { prisma } from "@/lib/db";
import { analyzePerformance } from "@/lib/ai/index";
import type { PerformancePost } from "@/lib/ai/index";
import {
  computeEngagementRate,
  computeFormatMix,
  identifyTopPerformers,
  isMetricsMature,
  type AnalyzablePost,
} from "./analyze";
import { PerformanceAnalysisSchema, DigestChangesSchema } from "./schemas";

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_POSTS_FOR_OPTIMIZATION = 10;
const MAX_FORMAT_MIX_DELTA = 0.2;
const MAX_CADENCE_DELTA = 2;

// ── Guardrails ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyGuardrails(analysis: {
  patterns: string[];
  formatMixChanges?: Record<string, number>;
  cadenceChanges?: Record<string, number>;
  topicInsights?: string[];
  digest: string;
}): {
  patterns: string[];
  formatMixChanges?: Record<string, number>;
  cadenceChanges?: Record<string, number>;
  topicInsights?: string[];
  digest: string;
} {
  const result = { ...analysis };

  if (result.formatMixChanges) {
    const capped: Record<string, number> = {};
    for (const [key, delta] of Object.entries(result.formatMixChanges)) {
      capped[key] = clamp(delta, -MAX_FORMAT_MIX_DELTA, MAX_FORMAT_MIX_DELTA);
    }
    result.formatMixChanges = capped;
  }

  if (result.cadenceChanges) {
    const capped: Record<string, number> = {};
    for (const [key, delta] of Object.entries(result.cadenceChanges)) {
      capped[key] = clamp(Math.round(delta), -MAX_CADENCE_DELTA, MAX_CADENCE_DELTA);
    }
    result.cadenceChanges = capped;
  }

  return result;
}

// ── Format mix application ───────────────────────────────────────────────────

function applyFormatMixChanges(
  current: Record<string, number> | null,
  changes: Record<string, number>
): Record<string, number> {
  const base = current ?? {};
  const updated: Record<string, number> = { ...base };

  for (const [format, delta] of Object.entries(changes)) {
    updated[format] = clamp((updated[format] ?? 0) + delta, 0, 1);
  }

  // Normalize to sum to 1
  const total = Object.values(updated).reduce((s, v) => s + v, 0);
  if (total > 0) {
    for (const key of Object.keys(updated)) {
      updated[key] = updated[key] / total;
    }
  }

  return updated;
}

// ── Cadence application ──────────────────────────────────────────────────────

function applyCadenceChanges(
  current: Record<string, number> | null,
  changes: Record<string, number>
): Record<string, number> {
  const base = current ?? {};
  const updated: Record<string, number> = { ...base };

  for (const [platform, delta] of Object.entries(changes)) {
    updated[platform] = Math.max(1, Math.round((updated[platform] ?? 3) + delta));
  }

  return updated;
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runWeeklyOptimization(): Promise<{
  processed: number;
  skipped: number;
}> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  // Find businesses with content strategies
  const businesses = await prisma.business.findMany({
    where: {
      contentStrategy: { isNot: null },
    },
    include: {
      contentStrategy: true,
    },
  });

  let processed = 0;
  let skipped = 0;

  for (const business of businesses) {
    const strategy = business.contentStrategy;
    if (!strategy) {
      skipped++;
      continue;
    }

    try {
      // Fetch last 30 days of published posts with metrics
      const posts = await prisma.post.findMany({
        where: {
          businessId: business.id,
          status: "PUBLISHED",
          publishedAt: { gte: thirtyDaysAgo },
        },
        include: {
          socialAccount: { select: { platform: true } },
          contentBrief: { select: { recommendedFormat: true } },
        },
      });

      // Filter to posts with mature metrics
      const maturePosts: AnalyzablePost[] = posts
        .map((p) => ({
          id: p.id,
          platform: p.socialAccount.platform as AnalyzablePost["platform"],
          topicPillar: p.topicPillar,
          tone: p.tone,
          format: p.contentBrief?.recommendedFormat ?? null,
          metricsLikes: p.metricsLikes,
          metricsComments: p.metricsComments,
          metricsShares: p.metricsShares,
          metricsSaves: p.metricsSaves,
          metricsUpdatedAt: p.metricsUpdatedAt,
          publishedAt: p.publishedAt,
        }))
        .filter((p) => isMetricsMature(p, now));

      if (maturePosts.length < MIN_POSTS_FOR_OPTIMIZATION) {
        skipped++;
        continue;
      }

      // Compute current format mix
      const currentFormatMix = computeFormatMix(maturePosts);

      // Build performance data for Claude
      const performancePosts: PerformancePost[] = maturePosts.map((p) => ({
        id: p.id,
        platform: p.platform,
        format: p.format,
        topicPillar: p.topicPillar,
        tone: p.tone,
        engagementRate: computeEngagementRate(p),
        metricsLikes: p.metricsLikes ?? 0,
        metricsComments: p.metricsComments ?? 0,
        metricsShares: p.metricsShares ?? 0,
        metricsSaves: p.metricsSaves ?? 0,
      }));

      // Call Claude
      const rawAnalysis = await analyzePerformance({
        posts: performancePosts,
        strategy: {
          industry: strategy.industry,
          targetAudience: strategy.targetAudience,
          contentPillars: strategy.contentPillars,
          brandVoice: strategy.brandVoice,
        },
        currentFormatMix,
      });

      // Validate with Zod
      const analysis = PerformanceAnalysisSchema.parse(rawAnalysis);

      // Apply guardrails
      const guarded = applyGuardrails(analysis);

      // Compute top performers for digest
      const topPerformers = identifyTopPerformers(maturePosts, 5);

      // Build changes record (typed as Prisma InputJsonValue-compatible)
      const changes: Record<string, string | number | boolean | null | Record<string, number> | string[]> = {};
      let newFormatMix: Record<string, number> | undefined;
      let newCadence: Record<string, number> | undefined;

      if (guarded.formatMixChanges && Object.keys(guarded.formatMixChanges).length > 0) {
        newFormatMix = applyFormatMixChanges(
          strategy.formatMix as Record<string, number> | null,
          guarded.formatMixChanges
        );
        changes.formatMix = guarded.formatMixChanges;
      }

      if (guarded.cadenceChanges && Object.keys(guarded.cadenceChanges).length > 0) {
        newCadence = applyCadenceChanges(
          strategy.postingCadence as Record<string, number> | null,
          guarded.cadenceChanges
        );
        changes.cadence = guarded.cadenceChanges;
      }

      if (guarded.topicInsights) {
        changes.topicInsights = guarded.topicInsights;
      }

      // Validate changes before persisting
      DigestChangesSchema.parse(changes);

      // Update ContentStrategy
      await prisma.contentStrategy.update({
        where: { businessId: business.id },
        data: {
          ...(newFormatMix && { formatMix: newFormatMix }),
          ...(newCadence && { postingCadence: newCadence }),
          lastOptimizedAt: now,
        },
      });

      // Compute weekOf (Monday of this week)
      const weekOf = getWeekOf(now);

      // Create StrategyDigest
      await prisma.strategyDigest.create({
        data: {
          businessId: business.id,
          weekOf,
          summary: guarded.digest,
          patterns: JSON.parse(JSON.stringify({
            topPerformers,
            insights: guarded.patterns,
          })),
          changes: JSON.parse(JSON.stringify(changes)),
        },
      });

      processed++;
    } catch (err) {
      console.error(`Optimization failed for business ${business.id}:`, err);
      skipped++;
    }
  }

  return { processed, skipped };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get Monday 00:00 UTC of the given date's week */
function getWeekOf(date: Date): Date {
  const d = new Date(date);
  const dayOfWeek = d.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  d.setUTCDate(d.getUTCDate() - daysFromMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
