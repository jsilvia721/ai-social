/**
 * Scheduler — invoked by two AWS EventBridge Lambda functions:
 *   src/cron/publish.ts  → every 1 minute
 *   src/cron/metrics.ts  → every 1 hour
 */
import { prisma } from "@/lib/db";
import { publishPost } from "@/lib/blotato/publish";
import { getPostMetrics } from "@/lib/blotato/metrics";
import { BlotatoApiError, isBlotatoApiError } from "@/lib/blotato/client";
import { sendFailureAlert } from "@/lib/alerts";
import { reportServerError } from "@/lib/server-error-reporter";
import { normalizeMessage } from "@/lib/normalize-error";
import { MEDIA_REQUIRED_PLATFORMS } from "@/lib/platform-rules";
import type { Post, SocialAccount, Business, BusinessMember, User } from "@prisma/client";

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

// ── Retry helpers ────────────────────────────────────────────────────────────

function retryDelayMs(attempt: number): number {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * Math.pow(2, attempt));
  return Math.random() * ceiling; // full jitter
}

function shouldRetry(err: unknown, retryCount: number): boolean {
  if (retryCount >= MAX_RETRIES) return false;
  // Don't retry 4xx client errors (except 429 rate limit)
  if (isBlotatoApiError(err) && err.status >= 400 && err.status < 500 && err.status !== 429) {
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

  // Log to ErrorReport table — fire-and-forget (must never crash the publisher)
  try {
    await reportServerError(errorMessage, {
      url: "cron/publish",
      metadata: {
        postId: post.id,
        platform: post.socialAccount.platform,
        businessId: post.businessId,
        retryCount,
        source: "blotato-publish",
      },
    });
  } catch {
    // Swallow — error reporting must not interfere with publishing
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
      { coverImageUrl: post.coverImageUrl ?? undefined },
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
    await reportServerError(
      `Auto-approval failed: ${err instanceof Error ? err.message : String(err)}`,
      {
        url: "cron/auto-approval",
        metadata: { source: "auto-approval" },
      }
    ).catch(() => {});
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

  // Collect failures by normalized error pattern for batched reporting
  const errorBuckets = new Map<string, {
    count: number;
    postIds: string[];
    blotatoPostIds: string[];
    sampleMessage: string;
  }>();

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
      } catch (err) {
        // 404 means the Blotato post no longer exists — clear the stale ID
        // so it's permanently excluded from future metrics fetches.
        if (isBlotatoApiError(err) && err.status === 404) {
          console.info(`[metrics-refresh] Clearing stale blotatoPostId for post ${post.id}`);
          try {
            await prisma.post.update({
              where: { id: post.id },
              data: { blotatoPostId: null },
            });
          } catch (cleanupErr) {
            const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            console.warn(`[metrics-refresh] Failed to clear blotatoPostId for post ${post.id}:`, msg);
          }
          return;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[metrics-refresh] Failed to refresh metrics for post ${post.id}:`, errorMessage);

        // For non-404 errors (rate limits, 5xx, timeouts), update metricsUpdatedAt
        // to rotate the post to the back of the queue.
        try {
          await prisma.post.update({
            where: { id: post.id },
            data: { metricsUpdatedAt: new Date() },
          });
        } catch {
          // Swallow — DB update must not crash the batch
        }

        // Collect error for batched reporting.
        // Safe: all awaits have completed before this synchronous Map mutation.
        const key = normalizeMessage(errorMessage);
        const bucket = errorBuckets.get(key);
        if (bucket) {
          bucket.count += 1;
          bucket.postIds.push(post.id);
          bucket.blotatoPostIds.push(post.blotatoPostId!);
        } else {
          errorBuckets.set(key, {
            count: 1,
            postIds: [post.id],
            blotatoPostIds: [post.blotatoPostId!],
            sampleMessage: errorMessage,
          });
        }
      }
    })
  );

  // Report aggregated errors — once per unique error pattern
  for (const bucket of errorBuckets.values()) {
    try {
      await reportServerError(bucket.sampleMessage, {
        url: "cron/metrics",
        metadata: {
          count: bucket.count,
          postIds: bucket.postIds,
          blotatoPostIds: bucket.blotatoPostIds,
          sampleMessage: bucket.sampleMessage,
          source: "blotato-metrics",
        },
      });
    } catch {
      // Swallow — error reporting must not interfere with metrics batch
    }
  }

  return { processed: posts.length };
}
