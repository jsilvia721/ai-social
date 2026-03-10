import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

/** GET /api/businesses/[id]/digests — returns last 4 strategy digests */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: businessId } = await params;

  // Verify user is a member of this business (admins bypass)
  const isAdmin = session.user.isAdmin ?? false;
  if (!isAdmin) {
    const member = await prisma.businessMember.findFirst({
      where: { businessId, userId: session.user.id },
    });
    if (!member) {
      return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
    }
  }

  const digests = await prisma.strategyDigest.findMany({
    where: { businessId },
    orderBy: { weekOf: "desc" },
    take: 4,
  });

  return NextResponse.json({ digests });
}
