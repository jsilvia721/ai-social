import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { extractContentStrategy } from "@/lib/ai";
import { WizardAnswersSchema } from "@/lib/strategy/schemas";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: businessId } = await params;

  // Owner-only — creating a content strategy is a high-impact action
  const isAdmin = session.user.isAdmin ?? false;
  if (!isAdmin) {
    const member = await prisma.businessMember.findFirst({
      where: { businessId, userId: session.user.id },
    });
    if (!member) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (member.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only business owners can set up content strategy" },
        { status: 403 }
      );
    }
  }

  // Idempotent: return existing strategy without calling Claude
  const existing = await prisma.contentStrategy.findUnique({
    where: { businessId },
  });
  if (existing) {
    return NextResponse.json({ strategy: existing });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.answers) {
    return NextResponse.json(
      { error: "answers are required when no strategy exists" },
      { status: 400 }
    );
  }

  const parsed = WizardAnswersSchema.safeParse(body.answers);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid answers", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const strategyData = await extractContentStrategy(parsed.data);
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
