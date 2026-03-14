import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getReviewPosts, serializeReviewPosts } from "@/lib/queries/review-posts";
import { ReviewQueueClient } from "./review-queue-client";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const posts = await getReviewPosts(session);

  if (posts === null) {
    return (
      <div className="text-center py-16 text-zinc-400">
        <p>Select a workspace to view posts awaiting review.</p>
      </div>
    );
  }

  return <ReviewQueueClient initialPosts={serializeReviewPosts(posts)} />;
}
