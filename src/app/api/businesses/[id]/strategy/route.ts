import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

/** GET /api/businesses/[id]/strategy — returns review/fulfillment config */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  if (!isAdmin) {
    const membership = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId: id, userId: session.user.id } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
    }
  }

  const strategy = await prisma.contentStrategy.findUnique({
    where: { businessId: id },
    select: {
      reviewWindowEnabled: true,
      reviewWindowHours: true,
      postingCadence: true,
      formatMix: true,
    },
  });

  if (!strategy) {
    return NextResponse.json({ error: "No strategy configured" }, { status: 404 });
  }

  return NextResponse.json(strategy);
}

const PatchSchema = z.object({
  reviewWindowEnabled: z.boolean().optional(),
  reviewWindowHours: z.number().int().min(1).max(168).optional(), // 1h to 1 week
});

/** PATCH /api/businesses/[id]/strategy — update review/fulfillment config */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  // Owner-only — changing review settings affects whether posts auto-publish
  const membership = isAdmin
    ? null
    : await prisma.businessMember.findUnique({
        where: { businessId_userId: { businessId: id, userId: session.user.id } },
      });
  if (!isAdmin && (!membership || membership.role !== "OWNER")) {
    return NextResponse.json(
      { error: "Only business owners can update strategy" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const strategy = await prisma.contentStrategy.update({
    where: { businessId: id },
    data: parsed.data,
    select: {
      reviewWindowEnabled: true,
      reviewWindowHours: true,
    },
  });

  return NextResponse.json(strategy);
}
