import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSafeMediaUrl } from "@/lib/blotato/ssrf-guard";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const PatchPostSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  scheduledAt: z.string().nullable().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const isAdmin = session.user.isAdmin ?? false;

  const post = await prisma.post.findFirst({
    where: {
      id,
      ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.status === "PUBLISHED") {
    return NextResponse.json({ error: "Cannot edit a published post" }, { status: 400 });
  }

  const raw = await req.json().catch(() => null);
  const parsed = PatchPostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { content, scheduledAt, mediaUrls } = parsed.data;

  // Block status-changing operations on PENDING_REVIEW posts (must use approve/reject APIs)
  if (post.status === "PENDING_REVIEW" && scheduledAt !== undefined) {
    return NextResponse.json(
      { error: "Cannot change scheduling of a post in review. Use approve/reject instead." },
      { status: 400 }
    );
  }

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
