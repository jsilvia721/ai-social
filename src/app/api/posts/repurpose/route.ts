import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { repurposeContent } from "@/lib/ai/repurpose";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Platform } from "@/types";

const PLATFORMS = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;

const RepurposeRequestSchema = z.object({
  sourceContent: z.string().min(1).max(10000),
  targetPlatforms: z.array(z.enum(PLATFORMS)).optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PENDING_REVIEW"]).default("DRAFT"),
  scheduledAt: z.string().datetime().transform(s => new Date(s)).optional(),
}).refine(
  (data) => data.status !== "SCHEDULED" || data.scheduledAt,
  { message: "scheduledAt required when status is SCHEDULED", path: ["scheduledAt"] }
);

/** POST /api/posts/repurpose — generate platform-native variants from source content */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = RepurposeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const businessId = session.user.activeBusinessId;
  if (!businessId) {
    return NextResponse.json({ error: "No active business" }, { status: 400 });
  }

  // Verify membership
  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  // Fetch accounts + strategy in parallel
  const [accounts, strategy] = await Promise.all([
    prisma.socialAccount.findMany({ where: { businessId } }),
    prisma.contentStrategy.findUnique({ where: { businessId } }),
  ]);

  if (accounts.length === 0) {
    return NextResponse.json({ error: "No connected accounts. Connect a social account first." }, { status: 400 });
  }

  if (!strategy) {
    return NextResponse.json({ error: "Complete onboarding first to set up your content strategy." }, { status: 400 });
  }

  // Determine target platforms (intersect requested with connected)
  const connectedPlatforms = [...new Set(accounts.map(a => a.platform))] as Platform[];
  const targetPlatforms = parsed.data.targetPlatforms
    ? parsed.data.targetPlatforms.filter(p => connectedPlatforms.includes(p))
    : connectedPlatforms;

  if (targetPlatforms.length === 0) {
    return NextResponse.json({ error: "None of the requested platforms are connected." }, { status: 400 });
  }

  // Build platform → account map (first account per platform)
  const accountMap = new Map<Platform, typeof accounts[0]>();
  for (const account of accounts) {
    if (!accountMap.has(account.platform as Platform)) {
      accountMap.set(account.platform as Platform, account);
    }
  }

  // Call AI outside transaction
  let result;
  try {
    result = await repurposeContent({
      sourceContent: parsed.data.sourceContent,
      targetPlatforms,
      strategy: {
        industry: strategy.industry,
        targetAudience: strategy.targetAudience,
        contentPillars: strategy.contentPillars,
        brandVoice: strategy.brandVoice,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Create posts in transaction
  const groupId = crypto.randomUUID();
  const posts = await prisma.$transaction(async (tx) => {
    const created = [];
    for (const variant of result.variants) {
      const account = accountMap.get(variant.platform as Platform);
      if (!account) continue; // Skip variants for unconnected platforms

      const post = await tx.post.create({
        data: {
          businessId,
          socialAccountId: account.id,
          content: variant.content,
          mediaUrls: [],
          status: parsed.data.status,
          scheduledAt: parsed.data.scheduledAt ?? null,
          repurposeGroupId: groupId,
          topicPillar: variant.topicPillar ?? null,
          tone: variant.tone ?? null,
        },
      });
      created.push(post);
    }
    return created;
  }, { timeout: 10000 });

  return NextResponse.json({ repurposeGroupId: groupId, posts }, { status: 201 });
}
