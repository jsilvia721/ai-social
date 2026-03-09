import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ReviewQueueClient } from "./review-queue-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const activeBusinessId = session.user.activeBusinessId;
  if (!activeBusinessId) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>Select a workspace to view posts awaiting review.</p>
      </div>
    );
  }

  // Verify the user is a member of this business
  const membership = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: { businessId: activeBusinessId, userId: session.user.id },
    },
  });
  if (!membership) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>You do not have access to this workspace.</p>
      </div>
    );
  }

  const posts = await prisma.post.findMany({
    where: {
      businessId: activeBusinessId,
      status: "PENDING_REVIEW",
    },
    orderBy: [
      { reviewWindowExpiresAt: "asc" },
      { scheduledAt: "asc" },
    ],
    include: {
      socialAccount: { select: { platform: true, username: true } },
      contentBrief: { select: { id: true, topic: true, recommendedFormat: true } },
    },
    take: 50,
  });

  // Serialize Date fields to strings for the client component
  const serialized = posts.map((p) => ({
    ...p,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    reviewWindowExpiresAt: p.reviewWindowExpiresAt?.toISOString() ?? null,
  }));

  return <ReviewQueueClient initialPosts={serialized} />;
}
