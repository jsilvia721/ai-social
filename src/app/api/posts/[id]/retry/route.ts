import { authOptions } from "@/lib/auth";
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
      ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    },
  });

  if (!post) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (post.status !== "FAILED") {
    return NextResponse.json(
      { error: "Only failed posts can be retried" },
      { status: 400 }
    );
  }

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "SCHEDULED",
      errorMessage: null,
    },
  });

  return NextResponse.json(updated);
}
