import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requiresMedia } from "@/lib/platform-rules";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** POST /api/posts/[id]/approve — transition PENDING_REVIEW → SCHEDULED */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  const post = await prisma.post.findFirst({
    where: {
      id,
      ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    },
    include: { socialAccount: true },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Idempotent: already approved
  if (post.status === "SCHEDULED") {
    return NextResponse.json({ ...post, alreadyApproved: true });
  }

  // Validate media requirement before approving (approve transitions to SCHEDULED)
  if (post.socialAccount) {
    const mediaUrls = (post.mediaUrls as string[]) ?? [];
    if (requiresMedia(post.socialAccount.platform) && mediaUrls.length === 0) {
      return NextResponse.json(
        { error: `${post.socialAccount.platform} requires at least one image or video` },
        { status: 400 }
      );
    }
  }

  if (post.status !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `Cannot approve a post with status ${post.status}` },
      { status: 400 }
    );
  }

  // Atomic status guard — prevents race with auto-approval cron
  const result = await prisma.post.updateMany({
    where: { id, status: "PENDING_REVIEW" },
    data: { status: "SCHEDULED", reviewWindowExpiresAt: null },
  });

  if (result.count === 0) {
    // Re-fetch: may have been auto-approved between read and write
    const current = await prisma.post.findUnique({ where: { id } });
    if (current?.status === "SCHEDULED") {
      return NextResponse.json({ ...current, alreadyApproved: true });
    }
    return NextResponse.json(
      { error: "Post is no longer in review" },
      { status: 409 }
    );
  }

  const updated = await prisma.post.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
