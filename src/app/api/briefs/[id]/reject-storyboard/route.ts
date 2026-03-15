import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** POST /api/briefs/[id]/reject-storyboard — reject storyboard, cancel the brief */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const brief = await prisma.contentBrief.findUnique({
    where: { id },
    select: { id: true, businessId: true, status: true },
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

  if (brief.status !== "STORYBOARD_REVIEW") {
    return NextResponse.json(
      { error: "Brief must be in STORYBOARD_REVIEW status" },
      { status: 409 }
    );
  }

  await prisma.contentBrief.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  return NextResponse.json({ ok: true });
}
