import { NextRequest, NextResponse } from "next/server";
import type { SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publishTweet } from "@/lib/platforms/twitter";
import { publishInstagramPost } from "@/lib/platforms/instagram";
import { publishFacebookPost } from "@/lib/platforms/facebook";
import { ensureValidToken } from "@/lib/token";

interface DuePost {
  id: string;
  content: string;
  mediaUrls: string[];
  socialAccount: SocialAccount;
}

// Called by a cron job to publish scheduled posts
export async function POST(_req: NextRequest) {
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
          const result = await publishTweet(token, post.content);
          platformPostId = result.id;
        } else if (socialAccount.platform === "INSTAGRAM") {
          const result = await publishInstagramPost(
            token,
            socialAccount.platformId,
            post.content,
            post.mediaUrls[0]
          );
          platformPostId = result.id;
        } else {
          const result = await publishFacebookPost(
            token,
            socialAccount.platformId,
            post.content
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

  return NextResponse.json({ processed: duePosts.length, results });
}
