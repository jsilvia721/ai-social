import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConnectUrl } from "@/lib/blotato/accounts";
import { env } from "@/env";
import type { Platform } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const ACCOUNTS_URL = "/dashboard/accounts";

// Mock usernames shown in the UI when BLOTATO_MOCK=true
const MOCK_USERNAMES: Record<string, string> = {
  TWITTER: "mockuser_twitter",
  INSTAGRAM: "mockuser_instagram",
  FACEBOOK: "mockuser_facebook",
  TIKTOK: "mockuser_tiktok",
  YOUTUBE: "mockuser_youtube",
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const businessId = searchParams.get("businessId");

  if (!platform) {
    return NextResponse.json({ error: "platform is required" }, { status: 400 });
  }
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required" }, { status: 400 });
  }

  const isAdmin = session.user.isAdmin ?? false;

  if (!isAdmin) {
    const membership = await prisma.businessMember.findFirst({
      where: { userId: session.user.id, businessId },
    });
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // ── Mock mode: skip Blotato OAuth, create a fake account directly ────────
  if (process.env.BLOTATO_MOCK === "true") {
    try {
      await prisma.socialAccount.upsert({
        where: { platform_platformId: { platform: platform as Platform, platformId: `mock-${platform.toLowerCase()}-${businessId}` } },
        create: {
          businessId,
          platform: platform as Platform,
          platformId: `mock-${platform.toLowerCase()}-${businessId}`,
          blotatoAccountId: `mock-blotato-${platform.toLowerCase()}-${businessId}`,
          username: MOCK_USERNAMES[platform] ?? `mockuser_${platform.toLowerCase()}`,
        },
        update: {
          username: MOCK_USERNAMES[platform] ?? `mockuser_${platform.toLowerCase()}`,
        },
      });
      return NextResponse.redirect(new URL(`${ACCOUNTS_URL}?success=true`, req.url), 302);
    } catch (err) {
      console.error("[blotato-connect] mock upsert failed:", err);
      return NextResponse.redirect(new URL(`${ACCOUNTS_URL}?error=connect`, req.url), 302);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const state = Buffer.from(
    JSON.stringify({ userId: session.user.id, businessId })
  ).toString("base64url");

  const callbackUrl = `${env.NEXTAUTH_URL}/api/connect/blotato/callback`;

  try {
    const { url } = await getConnectUrl(platform, callbackUrl, state);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    console.error("[blotato-connect] failed to get connect URL:", err);
    return NextResponse.redirect(new URL(`${ACCOUNTS_URL}?error=connect`, req.url), 302);
  }
}
