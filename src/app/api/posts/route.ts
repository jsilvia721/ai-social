import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const posts = await prisma.post.findMany({
    where: {
      userId: session.user.id,
      ...(status ? { status: status as any } : {}),
    },
    include: { socialAccount: true },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json(posts);
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
    where: { id, userId: session.user.id },
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
  const { content, socialAccountId, scheduledAt, mediaUrls } = body;

  // Verify the social account belongs to the current user
  const account = await prisma.socialAccount.findFirst({
    where: { id: socialAccountId, userId: session.user.id },
  });

  if (!account) {
    return NextResponse.json({ error: "Social account not found" }, { status: 404 });
  }

  const post = await prisma.post.create({
    data: {
      content,
      socialAccountId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      mediaUrls: mediaUrls ?? [],
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
      userId: session.user.id,
    },
  });

  return NextResponse.json(post, { status: 201 });
}
