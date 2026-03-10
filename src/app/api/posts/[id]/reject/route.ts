import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** POST /api/posts/[id]/reject — transition PENDING_REVIEW → DRAFT, brief → CANCELLED */
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
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  // Idempotent: already rejected
  if (post.status === "DRAFT") {
    return NextResponse.json(post);
  }

  if (post.status !== "PENDING_REVIEW") {
    return NextResponse.json(
      { error: `Cannot reject a post with status ${post.status}` },
      { status: 400 }
    );
  }

  // Transaction: move post to DRAFT + cancel linked brief (with status guards on both)
  const [postResult] = await prisma.$transaction([
    prisma.post.updateMany({
      where: { id, status: "PENDING_REVIEW" },
      data: { status: "DRAFT", reviewWindowExpiresAt: null },
    }),
    ...(post.briefId
      ? [
          prisma.contentBrief.updateMany({
            where: { id: post.briefId, status: "FULFILLED" },
            data: { status: "CANCELLED" },
          }),
        ]
      : []),
  ]);

  // Status guard matched zero rows — post already transitioned
  if (postResult.count === 0) {
    return NextResponse.json(
      { error: "Post is no longer in review" },
      { status: 409 }
    );
  }

  const updated = await prisma.post.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
