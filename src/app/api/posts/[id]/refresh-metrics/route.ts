import { authOptions } from "@/lib/auth";
import { getPostMetrics } from "@/lib/blotato/metrics";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  const post = await prisma.post.findFirst({
    where: {
      id,
      ...(isAdmin
        ? {}
        : { business: { members: { some: { userId: session.user.id } } } }),
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (!post.blotatoPostId) {
    return NextResponse.json(
      {
        error:
          "Post has no Blotato ID — it may not have been published via Blotato",
      },
      { status: 400 }
    );
  }

  try {
    const metrics = await getPostMetrics(post.blotatoPostId);
    const metricsUpdatedAt = new Date();

    await prisma.post.update({
      where: { id: post.id },
      data: {
        ...metrics,
        metricsUpdatedAt,
      },
    });

    return NextResponse.json({ metrics, metricsUpdatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
