import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/briefs?businessId=xxx&status=PENDING&weekOf=2026-03-10 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = req.nextUrl.searchParams.get("businessId");
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  const status = req.nextUrl.searchParams.get("status") as string | null;
  const weekOfParam = req.nextUrl.searchParams.get("weekOf");

  const where: Record<string, unknown> = { businessId };
  if (status) where.status = status;
  if (weekOfParam) {
    const weekOfDate = new Date(weekOfParam);
    if (!isNaN(weekOfDate.getTime())) {
      where.weekOf = weekOfDate;
    }
  }

  const briefs = await prisma.contentBrief.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { scheduledFor: "asc" }],
  });

  return NextResponse.json(briefs);
}
