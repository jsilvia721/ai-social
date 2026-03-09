import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runFulfillment } from "@/lib/fulfillment";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** POST /api/fulfillment/run — on-demand fulfillment trigger (owner only) */
export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = session.user.activeBusinessId;
  if (!businessId) {
    return NextResponse.json({ error: "No active business" }, { status: 400 });
  }

  // Owner-only check
  const membership = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: { businessId, userId: session.user.id },
    },
  });
  if (!membership || (membership.role !== "OWNER" && !session.user.isAdmin)) {
    return NextResponse.json(
      { error: "Only business owners can trigger fulfillment" },
      { status: 403 }
    );
  }

  const result = await runFulfillment(businessId);
  return NextResponse.json(result);
}
