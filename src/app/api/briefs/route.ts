import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/briefs?status=PENDING&weekOf=2026-03-10
 *  Scoped to all businesses the user belongs to (matches /api/posts pattern).
 *  Optional businessId param narrows to a single workspace.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = req.nextUrl.searchParams.get("businessId");
  const status = req.nextUrl.searchParams.get("status") as string | null;
  const weekOfParam = req.nextUrl.searchParams.get("weekOf");

  const where: Record<string, unknown> = {
    business: { members: { some: { userId: session.user.id } } },
  };

  if (businessId) where.businessId = businessId;
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
