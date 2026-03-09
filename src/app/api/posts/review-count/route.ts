import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/** GET /api/posts/review-count — lightweight count for sidebar badge polling */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = session.user.activeBusinessId;
  if (!businessId) {
    return NextResponse.json({ count: 0 });
  }

  const count = await prisma.post.count({
    where: {
      businessId,
      status: "PENDING_REVIEW",
      business: {
        members: {
          some: { userId: session.user.id },
        },
      },
    },
  });

  return NextResponse.json({ count });
}
