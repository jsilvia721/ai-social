import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { generatePostContent } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { z } from "zod";
import type { Platform } from "@/types";

const bodySchema = z.object({
  topic: z.string().min(1).max(500),
  platform: z.enum(["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"]),
  tone: z.string().optional(),
  businessId: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { topic, platform, tone, businessId } = parsed.data;

  // Load Creative Profile if businessId is provided
  let creative: { accountType?: string; visualStyle?: string | null } | undefined;
  if (businessId) {
    const strategy = await prisma.contentStrategy.findUnique({
      where: { businessId },
      select: { accountType: true, visualStyle: true },
    });
    if (strategy) {
      creative = {
        accountType: strategy.accountType,
        visualStyle: strategy.visualStyle,
      };
    }
  }

  const content = await generatePostContent(topic, platform as Platform, {
    tone,
    creative,
  });
  return NextResponse.json({ content });
}
