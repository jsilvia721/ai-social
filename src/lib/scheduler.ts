/**
 * Scheduler stub — Phase 7 will rewrite this with Blotato publish,
 * PUBLISHING atomic claim, retry logic, and SES alerts.
 *
 * The actual invocation runs as two AWS EventBridge-triggered Lambda functions:
 *   src/cron/publish.ts  → every 1 minute
 *   src/cron/metrics.ts  → every 1 hour
 */
import { prisma } from "@/lib/db";
import { publishPost } from "@/lib/blotato/publish";

export async function runScheduler() {
  const now = new Date();

  const duePosts = await prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    include: {
      socialAccount: true,
    },
  });

  const results = await Promise.allSettled(
    duePosts.map(async (post) => {
      try {
        await prisma.post.update({
          where: { id: post.id },
          data: { status: "PUBLISHING" },
        });

        const { blotatoPostId } = await publishPost(
          post.socialAccount.blotatoAccountId ?? "",
          post.content,
          post.mediaUrls,
        );

        await prisma.post.update({
          where: { id: post.id },
          data: { status: "PUBLISHED", publishedAt: now, blotatoPostId },
        });

        return { postId: post.id, success: true };
      } catch (err) {
        await prisma.post.update({
          where: { id: post.id },
          data: {
            status: "FAILED",
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        });

        return { postId: post.id, success: false };
      }
    })
  );

  return { processed: duePosts.length, results };
}

export async function runMetricsRefresh() {
  // Phase 7: fetch metrics via Blotato API and update post records.
  return { processed: 0 };
}
