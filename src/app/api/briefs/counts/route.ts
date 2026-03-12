import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

/** GET /api/briefs/counts — pending brief counts per workspace for the current user */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = session.user.isAdmin ?? false;

  let businessIdFilter: { in: string[] } | undefined;
  if (!isAdmin) {
    const memberships = await prisma.businessMember.findMany({
      where: { userId: session.user.id },
      select: { businessId: true },
    });

    const businessIds = memberships.map((m) => m.businessId);
    if (businessIds.length === 0) {
      return NextResponse.json({});
    }
    businessIdFilter = { in: businessIds };
  }

  const counts = await prisma.contentBrief.groupBy({
    by: ["businessId"],
    where: {
      ...(businessIdFilter ? { businessId: businessIdFilter } : {}),
      status: "PENDING",
    },
    _count: { id: true },
  });

  const result: Record<string, number> = {};
  for (const c of counts) {
    result[c.businessId] = c._count.id;
  }

  return NextResponse.json(result);
}
