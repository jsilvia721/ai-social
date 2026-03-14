import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeBusinessId = session.user.activeBusinessId;
  if (!activeBusinessId) {
    return NextResponse.json(
      { error: "No active workspace selected" },
      { status: 400 }
    );
  }

  // Verify the user is a member of this business (admin bypasses)
  const isAdmin = session.user.isAdmin ?? false;
  if (!isAdmin) {
    const membership = await prisma.businessMember.findUnique({
      where: {
        businessId_userId: {
          businessId: activeBusinessId,
          userId: session.user.id,
        },
      },
    });
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
      contentBrief: {
        select: { id: true, topic: true, recommendedFormat: true },
      },
    },
    take: 50,
  });

  // Serialize Date fields to strings for the client
  const serialized = posts.map((p) => ({
    ...p,
    scheduledAt: p.scheduledAt?.toISOString() ?? null,
    reviewWindowExpiresAt: p.reviewWindowExpiresAt?.toISOString() ?? null,
  }));

  return NextResponse.json({ posts: serialized });
}
