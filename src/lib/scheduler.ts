/**
 * Scheduler — invoked by two AWS EventBridge Lambda functions:
 *   src/cron/publish.ts  → every 1 minute
 *   src/cron/metrics.ts  → every 1 hour
 */
import { prisma } from "@/lib/db";
import { publishPost } from "@/lib/blotato/publish";
import { getPostMetrics } from "@/lib/blotato/metrics";
import { BlotatoApiError } from "@/lib/blotato/client";
import { sendFailureAlert } from "@/lib/alerts";
import type { Post, SocialAccount, Business, BusinessMember, User, Platform } from "@prisma/client";

// ── Types ────────────────────────────────────────────────────────────────────

type DuePost = Post & {
  socialAccount: SocialAccount;
  business: Business & {
    members: (BusinessMember & { user: User })[];
  };
};

// ── Constants ────────────────────────────────────────────────────────────────

const BATCH_SIZE = 20;
const MAX_RETRIES = 2; // 3 total attempts (0, 1, 2)
const STUCK_THRESHOLD_MS = 5 * 60_000; // 5 minutes
const RETRY_BASE_MS = 60_000; // 1 min base
const RETRY_CAP_MS = 30 * 60_000; // 30 min cap
const MEDIA_REQUIRED_PLATFORMS = new Set<Platform>(["INSTAGRAM", "TIKTOK"]);

// ── Retry helpers ────────────────────────────────────────────────────────────

function retryDelayMs(attempt: number): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * Math.pow(2, attempt));
  return Math.random() * ceiling; // full jitter
}

function shouldRetry(err: unknown, retryCount: number): boolean {
  if (retryCount >= MAX_RETRIES) return false;
  // Don't retry 4xx client errors (except 429 rate limit)
  if (err instanceof BlotatoApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
    return false;
  }
  return true;
}

// ── Publish helpers ───────────────────────────────────────────────────────────

async function handlePublishFailure(post: DuePost, err: unknown): Promise<void> {
  const errorMessage = err instanceof Error ? err.message : String(err);
  const retryCount = post.retryCount + 1;

  if (shouldRetry(err, post.retryCount)) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "RETRYING",
        retryCount,
        retryAt: new Date(Date.now() + retryDelayMs(retryCount)),
        errorMessage,
      },
    });
  } else {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage },
    });
    const owner = post.business.members.find((m) => m.role === "OWNER");
    if (owner) {
      await sendFailureAlert(
        owner.user.email,
        `[AI Social] Post failed to publish after ${MAX_RETRIES + 1} attempts`,
        [
          `Post ID: ${post.id}`,
          `Business: ${post.business.name}`,
          `Content preview: ${post.content.slice(0, 100)}`,
          `Error: ${errorMessage}`,
          ``,
          `Please check your social account connection and retry the post manually.`,
        ].join("\n"),
      );
    }
  }
}

async function publishOne(post: DuePost, now: Date): Promise<void> {
  // Atomic claim — prevents double-publish if two Lambda invocations race
  const claimed = await prisma.post.updateMany({
    where: { id: post.id, status: { in: ["SCHEDULED", "RETRYING"] } },
    data: { status: "PUBLISHING" },
  });
  if (claimed.count === 0) return; // another invocation claimed it

  // Validate media for platforms that require it
  const platform = post.socialAccount.platform;
  if (MEDIA_REQUIRED_PLATFORMS.has(platform) && post.mediaUrls.length === 0) {
    const err = new BlotatoApiError(`${platform} requires at least one image or video`, 400);
    await handlePublishFailure(post, err);
    return;
  }

  try {
    const { blotatoPostId } = await publishPost(
      post.socialAccount.blotatoAccountId ?? "",
      post.content,
      post.socialAccount.platform,
      post.mediaUrls,
    );
    await prisma.post.update({
      where: { id: post.id },
      data: {
        status: "PUBLISHED",
        publishedAt: now,
        blotatoPostId,
        retryCount: 0,
        retryAt: null,
      },
    });
  } catch (err) {
    await handlePublishFailure(post, err);
  }
}

// ── Stuck-post recovery ───────────────────────────────────────────────────────

async function recoverStuckPosts(): Promise<void> {
  const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MS);
  await prisma.post.updateMany({
    where: {
      status: "PUBLISHING",
      updatedAt: { lte: stuckBefore },
    },
    data: { status: "RETRYING" },
  });
}

// ── Auto-approval ────────────────────────────────────────────────────────────

async function autoApproveExpiredReviews(): Promise<void> {
  const now = new Date();
  const result = await prisma.post.updateMany({
    where: {
      status: "PENDING_REVIEW",
      reviewWindowExpiresAt: { lte: now, not: null },
    },
    data: { status: "SCHEDULED" },
  });
  if (result.count > 0) {
    console.log(`[scheduler] Auto-approved ${result.count} posts with expired review windows`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runScheduler(): Promise<{ processed: number }> {
  // Reset any posts stuck in PUBLISHING for > 5 min (Lambda crash / cold start gap)
  await recoverStuckPosts();

  // Auto-approve posts with expired review windows (BEFORE due-posts query for same-invocation pickup)
  try {
    await autoApproveExpiredReviews();
  } catch (err) {
    // Must NOT prevent publisher from running
    console.error("[scheduler] Auto-approval failed (non-fatal):", err);
  }

  const now = new Date();

  const duePosts = await prisma.post.findMany({
    where: {
      OR: [
        { status: "SCHEDULED", scheduledAt: { lte: now } },
        { status: "RETRYING", retryAt: { lte: now } },
      ],
    },
    include: {
      socialAccount: true,
      business: {
        include: {
          members: {
            where: { role: "OWNER" },
            include: { user: true },
          },
        },
      },
    },
  });

  // Process in batches to bound Lambda wall-clock time
  for (let i = 0; i < duePosts.length; i += BATCH_SIZE) {
    await Promise.allSettled(
      (duePosts as DuePost[]).slice(i, i + BATCH_SIZE).map((post) => publishOne(post, now))
    );
  }

  return { processed: duePosts.length };
}

export async function runMetricsRefresh(): Promise<{ processed: number }> {
  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      blotatoPostId: { not: null },
    },
    take: 50,
    orderBy: { metricsUpdatedAt: "asc" },
  });

  if (posts.length === 0) return { processed: 0 };

  await Promise.allSettled(
    posts.map(async (post) => {
      try {
        const metrics = await getPostMetrics(post.blotatoPostId!);
        await prisma.post.update({
          where: { id: post.id },
          data: {
            metricsLikes: metrics.likes,
            metricsComments: metrics.comments,
            metricsShares: metrics.shares,
            metricsImpressions: metrics.impressions,
            metricsReach: metrics.reach,
            metricsSaves: metrics.saves,
            metricsUpdatedAt: new Date(),
          },
        });
      } catch {
        // Best-effort — don't fail the whole batch if one post's metrics can't be fetched
      }
    })
  );

  return { processed: posts.length };
}
