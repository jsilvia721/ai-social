import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSafeMediaUrl } from "@/lib/blotato/ssrf-guard";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const FulfillSchema = z.object({
  caption: z.string().min(1),
  mediaUrls: z.array(z.string().url()).default([]),
  scheduledAt: z.string().datetime().optional(),
  socialAccountId: z.string(),
});

/** POST /api/briefs/[id]/fulfill — upload assets + create SCHEDULED post */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const brief = await prisma.contentBrief.findUnique({
    where: { id },
    select: {
      id: true, businessId: true, status: true, scheduledFor: true, platform: true,
      topic: true, recommendedFormat: true,
      business: { select: { contentStrategy: { select: { contentPillars: true } } } },
    },
  });

  if (!brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: brief.businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  if (brief.status !== "PENDING") {
    return NextResponse.json(
      { error: "Only PENDING briefs can be fulfilled" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = FulfillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { caption, mediaUrls, scheduledAt, socialAccountId } = parsed.data;

  // Validate media URLs against SSRF
  for (const url of mediaUrls) {
    try {
      assertSafeMediaUrl(url);
    } catch {
      return NextResponse.json(
        { error: `Invalid media URL: ${url}` },
        { status: 400 }
      );
    }
  }

  // Verify social account belongs to this business and matches platform
  const account = await prisma.socialAccount.findUnique({
    where: { id: socialAccountId },
    select: { id: true, businessId: true, platform: true },
  });
  if (!account || account.businessId !== brief.businessId) {
    return NextResponse.json({ error: "Invalid social account" }, { status: 400 });
  }
  if (account.platform !== brief.platform) {
    return NextResponse.json(
      { error: `Social account platform (${account.platform}) does not match brief platform (${brief.platform})` },
      { status: 400 }
    );
  }

  // Derive topic pillar from brief topic by matching against strategy pillars
  const pillars = brief.business?.contentStrategy?.contentPillars ?? [];
  const { matchPillar } = await import("@/lib/fulfillment");
  const matchedPillar = matchPillar(brief.topic ?? "", pillars);

  // Create post + update brief in an interactive transaction
  // (uses interactive form so postId can be set in the same transaction)
  const post = await prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        businessId: brief.businessId,
        socialAccountId,
        content: caption,
        mediaUrls,
        status: "SCHEDULED",
        scheduledAt: scheduledAt ? new Date(scheduledAt) : brief.scheduledFor,
        briefId: brief.id,
        topicPillar: matchedPillar,
      },
    });
    await tx.contentBrief.update({
      where: { id: brief.id },
      data: { status: "FULFILLED", postId: created.id },
    });
    return created;
  });

  // Find the next pending brief for auto-advance
  const nextBrief = await prisma.contentBrief.findFirst({
    where: {
      businessId: brief.businessId,
      status: "PENDING",
      id: { not: brief.id },
    },
    orderBy: [{ sortOrder: "asc" }, { scheduledFor: "asc" }],
    select: { id: true },
  });

  return NextResponse.json(
    { post, nextBriefId: nextBrief?.id ?? null },
    { status: 201 }
  );
}
