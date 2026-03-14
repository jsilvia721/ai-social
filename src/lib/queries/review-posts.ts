import { prisma } from "@/lib/db";

interface ReviewPostsSession {
  user: {
    id: string;
    isAdmin?: boolean;
    activeBusinessId?: string | null;
  };
}

/**
 * Fetch PENDING_REVIEW posts for a user's active business.
 *
 * Membership is enforced via a `business.members.some` filter so the
 * authorization check and data fetch happen in a single query.
 * Admin users bypass the membership filter.
 *
 * Returns `null` when no activeBusinessId is set.
 */
export async function getReviewPosts(session: ReviewPostsSession) {
  const { activeBusinessId } = session.user;
  if (!activeBusinessId) return null;

  const isAdmin = session.user.isAdmin ?? false;

  const posts = await prisma.post.findMany({
    where: {
      businessId: activeBusinessId,
      status: "PENDING_REVIEW",
      // Non-admin users must be a member of the business
      ...(!isAdmin && {
        business: {
          members: {
            some: { userId: session.user.id },
          },
        },
      }),
    },
    orderBy: [
      { reviewWindowExpiresAt: "asc" },
      { scheduledAt: "asc" },
    ],
    include: {
      socialAccount: { select: { platform: true, username: true } },
      contentBrief: {
        select: { id: true, topic: true, recommendedFormat: true },
      },
    },
    take: 50,
  });

  return posts;
}

/** Serialize Date fields to ISO strings for client consumption. */
export function serializeReviewPosts(
  posts: NonNullable<Awaited<ReturnType<typeof getReviewPosts>>>
) {
  return posts.map((p) => ({
    ...p,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    reviewWindowExpiresAt: p.reviewWindowExpiresAt?.toISOString() ?? null,
  }));
}
