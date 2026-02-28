import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PostComposer } from "@/components/posts/PostComposer";
import type { Platform } from "@/types";

type Props = { params: Promise<{ id: string }> };

export default async function EditPostPage({ params }: Props) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/auth/signin");

  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: { socialAccount: { select: { platform: true, username: true } } },
  });

  if (!post || post.status === "PUBLISHED") {
    redirect("/dashboard/posts");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Edit Post</h1>
        <p className="text-zinc-400 mt-1">Update your post content or schedule.</p>
      </div>
      <PostComposer
        editPost={{
          id: post.id,
          content: post.content,
          socialAccountId: post.socialAccountId,
          platform: post.socialAccount.platform as Platform,
          username: post.socialAccount.username,
          scheduledAt: post.scheduledAt?.toISOString() ?? null,
          mediaUrls: post.mediaUrls,
        }}
      />
    </div>
  );
}
