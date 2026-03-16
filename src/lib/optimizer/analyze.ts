import type { Platform } from "@/types";
import { PLATFORM_BASELINES, ENGAGEMENT_WEIGHTS, PLATFORM_ENGAGEMENT_WEIGHTS, METRICS_MATURE_HOURS } from "./constants";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnalyzablePost {
  id: string;
  platform: Platform;
  topicPillar: string | null;
  tone: string | null;
  format: string | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  metricsSaves: number | null;
  metricsUpdatedAt: Date | null;
  publishedAt: Date | null;
}

export interface GroupStats {
  count: number;
  avgEngagement: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalSaves: number;
}

export interface PerformerEntry {
  postId: string;
  score: number;
  format: string | null;
  topicPillar: string | null;
}

type Dimension = "format" | "topicPillar" | "tone" | "platform";

// ── Engagement Rate ──────────────────────────────────────────────────────────

export function computeEngagementRate(post: AnalyzablePost): number {
  const likes = post.metricsLikes ?? 0;
  const comments = post.metricsComments ?? 0;
  const shares = post.metricsShares ?? 0;
  const saves = post.metricsSaves ?? 0;

  const weights = PLATFORM_ENGAGEMENT_WEIGHTS[post.platform] ?? ENGAGEMENT_WEIGHTS;

  const raw =
    likes * weights.likes +
    comments * weights.comments +
    shares * weights.shares +
    saves * weights.saves;

  if (raw === 0) return 0;

  const baseline = PLATFORM_BASELINES[post.platform];
  const baselineScore =
    baseline.likes * weights.likes +
    baseline.comments * weights.comments +
    baseline.shares * weights.shares +
    baseline.saves * weights.saves;

  // Normalize against platform baseline
  return raw / baselineScore;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

export function groupPostsByDimension(
  posts: AnalyzablePost[],
  dimension: Dimension
): Record<string, GroupStats> {
  const groups: Record<string, AnalyzablePost[]> = {};

  for (const post of posts) {
    const key = (dimension === "platform" ? post.platform : post[dimension]) ?? "untagged";
    if (!groups[key]) groups[key] = [];
    groups[key].push(post);
  }

  const result: Record<string, GroupStats> = {};
  for (const [key, groupPosts] of Object.entries(groups)) {
    const totalLikes = groupPosts.reduce((s, p) => s + (p.metricsLikes ?? 0), 0);
    const totalComments = groupPosts.reduce((s, p) => s + (p.metricsComments ?? 0), 0);
    const totalShares = groupPosts.reduce((s, p) => s + (p.metricsShares ?? 0), 0);
    const totalSaves = groupPosts.reduce((s, p) => s + (p.metricsSaves ?? 0), 0);
    const avgEngagement =
      groupPosts.reduce((s, p) => s + computeEngagementRate(p), 0) / groupPosts.length;

    result[key] = {
      count: groupPosts.length,
      avgEngagement,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
    };
  }

  return result;
}

// ── Top / Bottom Performers ──────────────────────────────────────────────────

function rankPosts(posts: AnalyzablePost[]): PerformerEntry[] {
  return posts
    .map((p) => ({
      postId: p.id,
      score: computeEngagementRate(p),
      format: p.format,
      topicPillar: p.topicPillar,
    }))
    .sort((a, b) => b.score - a.score);
}

export function identifyTopPerformers(
  posts: AnalyzablePost[],
  n: number
): PerformerEntry[] {
  return rankPosts(posts).slice(0, n);
}

export function identifyBottomPerformers(
  posts: AnalyzablePost[],
  n: number
): PerformerEntry[] {
  return rankPosts(posts).reverse().slice(0, n);
}

// ── Format Mix ───────────────────────────────────────────────────────────────

export function computeFormatMix(
  posts: AnalyzablePost[]
): Record<string, number> {
  if (posts.length === 0) return {};

  const counts: Record<string, number> = {};
  for (const post of posts) {
    const key = post.format ?? "untagged";
    counts[key] = (counts[key] ?? 0) + 1;
  }

  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    result[key] = count / posts.length;
  }
  return result;
}

// ── Maturity Check ───────────────────────────────────────────────────────────

export function isMetricsMature(post: AnalyzablePost, now: Date): boolean {
  if (post.metricsUpdatedAt == null || post.publishedAt == null) return false;

  // Metrics must have been fetched after the post was published
  if (post.metricsUpdatedAt.getTime() < post.publishedAt.getTime()) return false;

  const hoursSincePublish =
    (now.getTime() - post.publishedAt.getTime()) / (1000 * 60 * 60);

  return hoursSincePublish >= METRICS_MATURE_HOURS[post.platform];
}
