import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { generateImage } from "@/lib/media";
import { uploadBuffer } from "@/lib/storage";
import { buildImagePrompt } from "@/lib/ai/prompts";
import { z } from "zod";
import { randomUUID } from "crypto";

const bodySchema = z.object({
  prompt: z.string().min(1).max(1000),
  businessId: z.string().min(1),
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

  const { prompt, businessId } = parsed.data;

  // Verify membership
  const membership = await prisma.businessMember.findUnique({
    where: {
      businessId_userId: { businessId, userId: session.user.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Load Creative Profile for prompt augmentation
  const strategy = await prisma.contentStrategy.findUnique({
    where: { businessId },
    select: { accountType: true, visualStyle: true },
  });

  const finalPrompt = strategy
    ? buildImagePrompt(prompt, {
        accountType: strategy.accountType,
        visualStyle: strategy.visualStyle,
      })
    : prompt;

  try {
    const { buffer, mimeType } = await generateImage(finalPrompt);

    let url: string;
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const key = `media/${businessId}/composer/${randomUUID()}.${ext}`;
    try {
      url = await uploadBuffer(buffer, key, mimeType);
    } catch {
      // S3/MinIO unavailable (local dev) — return inline data URL
      url = `data:${mimeType};base64,${buffer.toString("base64")}`;
    }

    return NextResponse.json({ url });
  } catch (err) {
    console.error("[generate-image] Error:", err);
    return NextResponse.json(
      { error: "Image generation failed" },
      { status: 500 }
    );
  }
}
