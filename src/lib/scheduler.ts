import { prisma } from "@/lib/db";
import { publishTweet } from "@/lib/platforms/twitter";
import { publishInstagramPost } from "@/lib/platforms/instagram";
import { publishFacebookPost } from "@/lib/platforms/facebook";
import { ensureValidToken } from "@/lib/token";
import {
  fetchTwitterMetrics,
  fetchFacebookMetrics,
  fetchInstagramMetrics,
} from "@/lib/analytics/fetchers";
import type { SocialAccount } from "@prisma/client";

interface DuePost {
  id: string;
  content: string;
  mediaUrls: string[];
  socialAccount: SocialAccount;
}

export async function runScheduler() {
  const now = new Date();

  const duePosts = await prisma.post.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    include: { socialAccount: true },
  });

  const results = await Promise.allSettled(
    (duePosts as DuePost[]).map(async (post) => {
      const { socialAccount } = post;

      try {
        const token = await ensureValidToken(socialAccount);
        let platformPostId: string;

        if (socialAccount.platform === "TWITTER") {
          const result = await publishTweet(token, post.content, post.mediaUrls);
          platformPostId = result.id;
        } else if (socialAccount.platform === "INSTAGRAM") {
          const result = await publishInstagramPost(
            token,
            socialAccount.platformId,
            post.content,
            post.mediaUrls
          );
          platformPostId = result.id;
        } else {
          const result = await publishFacebookPost(
            token,
            socialAccount.platformId,
            post.content,
            post.mediaUrls
          );
          platformPostId = result.id;
        }

        await prisma.post.update({
          where: { id: post.id },
          data: { status: "PUBLISHED", publishedAt: now, platformPostId },
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
  const staleThreshold = new Date(Date.now() - 50 * 60 * 1000); // 50 min ago

  const posts = await prisma.post.findMany({
    where: {
      status: "PUBLISHED",
      platformPostId: { not: null },
      OR: [
        { metricsUpdatedAt: null },
        { metricsUpdatedAt: { lt: staleThreshold } },
      ],
    },
    include: { socialAccount: true },
  });

  const results = await Promise.allSettled(
    posts.map(async (post) => {
      try {
        const token = await ensureValidToken(post.socialAccount);
        const { platform } = post.socialAccount;
        const postId = post.platformPostId!;

        let metrics;
        if (platform === "TWITTER") {
          metrics = await fetchTwitterMetrics(token, postId);
        } else if (platform === "INSTAGRAM") {
          metrics = await fetchInstagramMetrics(token, postId);
        } else {
          metrics = await fetchFacebookMetrics(token, postId);
        }

        if (!metrics) return;

        await prisma.post.update({
          where: { id: post.id },
          data: metrics,
        });
      } catch (err) {
        console.error(`[metrics] failed for post ${post.id}:`, err);
      }
    })
  );

  const errors = results.filter((r) => r.status === "rejected").length;
  if (errors > 0) {
    console.error(`[metrics] ${errors} refresh(es) failed`);
  }
}

let cronStarted = false;

export function schedulePostPublisher() {
  if (cronStarted) return;
  cronStarted = true;

  // Dynamically imported so node-cron is never bundled into the edge runtime
  import("node-cron").then(({ default: cron }) => {
    cron.schedule("* * * * *", async () => {
      try {
        await runScheduler();
      } catch (err) {
        console.error("[scheduler] error:", err);
      }
    });
    console.log("[scheduler] Post publisher started — running every minute");

    cron.schedule("* * * * *", async () => {
      try {
        await runMetricsRefresh();
      } catch (err) {
        console.error("[metrics] error:", err);
      }
    });
    console.log("[scheduler] Metrics refresher started — running every hour");
  });
}
