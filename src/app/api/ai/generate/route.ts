import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generatePostContent } from "@/lib/ai";
import { z } from "zod";
import type { Platform } from "@/types";

const bodySchema = z.object({
  topic: z.string().min(1).max(500),
  platform: z.enum(["TWITTER", "INSTAGRAM", "FACEBOOK"]),
  tone: z.string().optional(),
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

  const { topic, platform, tone } = parsed.data;

  const content = await generatePostContent(topic, platform as Platform, tone);
  return NextResponse.json({ content });
}
