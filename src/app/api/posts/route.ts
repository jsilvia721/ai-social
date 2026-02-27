import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");

  const posts = await prisma.post.findMany({
    where: status ? { status: status as any } : undefined,
    include: { socialAccount: true },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json(posts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { content, socialAccountId, scheduledAt, mediaUrls } = body;

  const post = await prisma.post.create({
    data: {
      content,
      socialAccountId,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      mediaUrls: mediaUrls ?? [],
      status: scheduledAt ? "SCHEDULED" : "DRAFT",
      userId: body.userId, // TODO: derive from session
    },
  });

  return NextResponse.json(post, { status: 201 });
}
