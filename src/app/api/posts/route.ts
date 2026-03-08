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
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50));
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const where = {
    // Always scope to businesses this user belongs to (auth guard)
    business: { members: { some: { userId: session.user.id } } },
    // Narrow to active workspace when provided
    ...(businessId ? { businessId } : {}),
    ...(status ? { status: status as import("@prisma/client").PostStatus } : {}),
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

  const post = await prisma.post.findFirst({
    where: { id, business: { members: { some: { userId: session.user.id } } } },
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
  const { content, socialAccountId, scheduledAt, mediaUrls, businessId } = body;

  if (!businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  // Verify social account belongs to this business and the user is a member
  const account = await prisma.socialAccount.findFirst({
    where: {
      id: socialAccountId,
      businessId,
      business: { members: { some: { userId: session.user.id } } },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "Social account not found" }, { status: 404 });
  }

  if (mediaUrls?.length) {
    mediaUrls.forEach(assertSafeMediaUrl);
  }

  const post = await prisma.post.create({
    data: {
      content,
      socialAccountId,
      businessId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      mediaUrls: mediaUrls ?? [],
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });

  return NextResponse.json(post, { status: 201 });
}
