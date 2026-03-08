import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractContentStrategy } from "@/lib/ai";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: businessId } = await params;

  // Verify user is a member of this business
  const member = await prisma.businessMember.findFirst({
    where: { businessId, userId: session.user.id },
  });
  if (!member) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Idempotent: return existing strategy without calling Claude
  const existing = await prisma.contentStrategy.findUnique({
    where: { businessId },
  });
  if (existing) {
    return NextResponse.json({ strategy: existing });
  }

  const body = await req.json();
  const { answers } = body as { answers?: Record<string, string> };

  if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) {
    return NextResponse.json(
      { error: "answers are required when no strategy exists" },
      { status: 400 }
    );
  }

  try {
    const strategyData = await extractContentStrategy(answers);
    const strategy = await prisma.contentStrategy.create({
      data: { businessId, ...strategyData },
    });
    return NextResponse.json({ strategy }, { status: 201 });
  } catch (err) {
    console.error("[onboard] content strategy extraction failed:", err);
    return NextResponse.json(
      { error: "Failed to generate content strategy. Please try again." },
      { status: 500 }
    );
  }
}
