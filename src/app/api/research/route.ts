import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runResearchPipeline } from "@/lib/research";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** GET /api/research?businessId=xxx — list research summaries for a business */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businessId = req.nextUrl.searchParams.get("businessId");
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  // Verify user is a member of this business
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  const limit = Math.min(50, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10));

  const summaries = await prisma.researchSummary.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(summaries);
}

/** POST /api/research — trigger a manual research run for a business */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { businessId?: string };
  if (!body.businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  // Verify user is a member of this business
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: body.businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  // Verify business has a content strategy
  const strategy = await prisma.contentStrategy.findUnique({
    where: { businessId: body.businessId },
  });
  if (!strategy) {
    return NextResponse.json(
      { error: "Business must have a content strategy before running research" },
      { status: 400 }
    );
  }

  const result = await runResearchPipeline();
  return NextResponse.json(result, { status: 201 });
}
