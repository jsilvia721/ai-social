import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSafeMediaUrl } from "@/lib/blotato/ssrf-guard";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const businessId = searchParams.get("businessId");
  const repurposeGroupId = searchParams.get("repurposeGroupId");
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const isAdmin = session.user.isAdmin ?? false;

  const where = {
    // Admins bypass membership check; non-admins scoped to their businesses
    ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    // Narrow to active workspace when provided
    ...(businessId ? { businessId } : {}),
    ...(status ? { status: status as import("@prisma/client").PostStatus } : {}),
    ...(repurposeGroupId ? { repurposeGroupId } : {}),
  };

  const [posts, total] = await prisma.$transaction([
    prisma.post.findMany({
      where,
      include: { socialAccount: true },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.post.count({ where }),
  ]);

  return NextResponse.json({ posts, total, page, limit });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

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

  await prisma.post.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { content, socialAccountId, scheduledAt, mediaUrls, businessId, coverImageUrl } = body;

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  // Verify social account belongs to this business (and user is a member if not admin)
  const isAdmin = session.user.isAdmin ?? false;
  const account = await prisma.socialAccount.findFirst({
    where: {
      id: socialAccountId,
      businessId,
      ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    },
  });

  if (!account) {
    return NextResponse.json({ error: "Social account not found" }, { status: 404 });
  }

  if (mediaUrls?.length) {
    mediaUrls.forEach(assertSafeMediaUrl);
  }

  if (coverImageUrl) {
    try {
      assertSafeMediaUrl(coverImageUrl);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid cover image URL" },
        { status: 400 }
      );
    }
  }

  const post = await prisma.post.create({
    data: {
      content,
      socialAccountId,
      businessId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      mediaUrls: mediaUrls ?? [],
      coverImageUrl: coverImageUrl ?? null,
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });

  return NextResponse.json(post, { status: 201 });
}
