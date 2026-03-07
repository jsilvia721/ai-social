import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSafeMediaUrl } from "@/lib/platforms/ssrf-guard";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.status === "PUBLISHED") {
    return NextResponse.json({ error: "Cannot edit a published post" }, { status: 400 });
  }

  const body = await req.json();
  const { content, scheduledAt, mediaUrls } = body;

  if (scheduledAt !== undefined && scheduledAt !== null) {
    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: "Invalid scheduledAt date" }, { status: 400 });
    }
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    if (scheduledDate < twoMinutesAgo) {
      return NextResponse.json({ error: "Cannot schedule a post in the past" }, { status: 400 });
    }
  }

  if (mediaUrls?.length) {
    mediaUrls.forEach(assertSafeMediaUrl);
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      ...(content !== undefined ? { content } : {}),
      ...(mediaUrls !== undefined ? { mediaUrls } : {}),
      ...(scheduledAt !== undefined
        ? {
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            status: scheduledAt ? "SCHEDULED" : "DRAFT",
          }
        : {}),
    },
  });

  return NextResponse.json(updated);
}
