import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { businessId?: string };
  if (!body.businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  const membership = await prisma.businessMember.findFirst({
    where: { userId: session.user.id, businessId: body.businessId },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeBusinessId: body.businessId },
  });

  return NextResponse.json({ activeBusinessId: body.businessId });
}
