import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateVideo } from "@/lib/media";
import { env } from "@/env";
import {
  PLATFORM_VIDEO_ASPECT_RATIO,
  VIDEO_DURATION_DEFAULT,
  VIDEO_MODEL_DEFAULT,
} from "@/lib/video";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

/** POST /api/briefs/[id]/approve-storyboard — approve storyboard, trigger video rendering */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const brief = await prisma.contentBrief.findUnique({
    where: { id },
    select: { id: true, businessId: true, status: true, platform: true, videoPrompt: true },
  });

  if (!brief) {
    return NextResponse.json({ error: "Brief not found" }, { status: 404 });
  }

  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: brief.businessId, userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  if (brief.status !== "STORYBOARD_REVIEW") {
    return NextResponse.json(
      { error: "Brief must be in STORYBOARD_REVIEW status" },
      { status: 409 }
    );
  }

  // Use edited prompt from body, or fall back to the AI-generated prompt on the brief
  const body = await req.json().catch(() => ({}));
  const prompt = (typeof body.videoPrompt === "string" && body.videoPrompt) || brief.videoPrompt || "";

  const aspectRatio = PLATFORM_VIDEO_ASPECT_RATIO[brief.platform];
  const webhookUrl = `${env.NEXTAUTH_URL}/api/webhooks/replicate`;

  const { predictionId } = await generateVideo({
    prompt,
    aspectRatio,
    webhookUrl,
    duration: VIDEO_DURATION_DEFAULT,
  });

  await prisma.contentBrief.update({
    where: { id },
    data: {
      replicatePredictionId: predictionId,
      videoModel: VIDEO_MODEL_DEFAULT,
      videoAspectRatio: aspectRatio,
      status: "RENDERING",
    },
  });

  return NextResponse.json({ predictionId });
}
