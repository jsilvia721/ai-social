import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const BulkScheduleSchema = z.object({
  postIds: z.array(z.string().min(1)).min(1),
  scheduledAt: z.string().datetime().transform(s => new Date(s)),
});

/** POST /api/posts/bulk-schedule — schedule multiple posts at once */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BulkScheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { postIds, scheduledAt } = parsed.data;

  // Verify all posts belong to a business the user is a member of
  const posts = await prisma.post.findMany({
    where: {
      id: { in: postIds },
      business: { members: { some: { userId: session.user.id } } },
    },
    select: { id: true },
  });

  if (posts.length !== postIds.length) {
    return NextResponse.json(
      { error: "One or more posts not found or not authorized" },
      { status: 403 }
    );
  }

  await prisma.$transaction(
    postIds.map(id => prisma.post.update({
      where: { id },
      data: { status: "SCHEDULED", scheduledAt },
    }))
  );

  return NextResponse.json({ scheduled: postIds.length }, { status: 200 });
}
