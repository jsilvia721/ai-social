import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { StrategyPatchSchema } from "@/lib/strategy/schemas";
import { STRATEGY_SELECT } from "@/lib/strategy/constants";

type Params = { params: Promise<{ id: string }> };

/** GET /api/businesses/[id]/strategy — returns full content strategy */
export async function GET(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  // Parallelize membership check and strategy fetch
  const [membership, strategy] = await Promise.all([
    isAdmin
      ? null
      : prisma.businessMember.findUnique({
          where: { businessId_userId: { businessId: id, userId: session.user.id } },
        }),
    prisma.contentStrategy.findUnique({
      where: { businessId: id },
      select: STRATEGY_SELECT,
    }),
  ]);

  if (!isAdmin && !membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  if (!strategy) {
    return NextResponse.json({ error: "No strategy configured" }, { status: 404 });
  }

  return NextResponse.json(strategy);
}

/** PATCH /api/businesses/[id]/strategy — update content strategy (OWNER-only) */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isAdmin = session.user.isAdmin ?? false;

  // Owner-only — changing strategy affects content generation pipeline
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
  const parsed = StrategyPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Optimistic locking via updatedAt
  const { updatedAt: clientUpdatedAt, ...updateData } = parsed.data;
  const current = await prisma.contentStrategy.findUnique({
    where: { businessId: id },
    select: { updatedAt: true },
  });

  if (!current) {
    return NextResponse.json({ error: "No strategy configured" }, { status: 404 });
  }

  if (current.updatedAt.toISOString() !== clientUpdatedAt) {
    return NextResponse.json(
      { error: "Settings were modified since you loaded them. Please refresh." },
      { status: 409 }
    );
  }

  const strategy = await prisma.contentStrategy.update({
    where: { businessId: id },
    data: updateData,
    select: STRATEGY_SELECT,
  });

  return NextResponse.json(strategy);
}
