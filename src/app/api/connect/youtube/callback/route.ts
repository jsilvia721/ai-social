import { env } from "@/env";
import { encryptToken } from "@/lib/crypto";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const GoogleTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_denied", req.url)
    );
  }

  const cookieStore = await cookies();
  const savedState = cookieStore.get("youtube_oauth_state")?.value;
  cookieStore.delete("youtube_oauth_state");

  if (!savedState || state !== savedState || !code) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_state_mismatch", req.url)
    );
  }

  // Exchange code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${env.NEXTAUTH_URL}/api/connect/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[youtube/callback] token exchange failed:", tokenRes.status, body);
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_token_failed", req.url)
    );
  }

  const tokenParseResult = GoogleTokenSchema.safeParse(await tokenRes.json());
  if (!tokenParseResult.success) {
    console.error("[youtube/callback] unexpected token response shape:", tokenParseResult.error);
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_token_failed", req.url)
    );
  }
  const { access_token, refresh_token, expires_in } = tokenParseResult.data;

  // Fetch the YouTube channel info (name + channel ID)
  const channelRes = await fetch(
    `${YOUTUBE_CHANNELS_URL}?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!channelRes.ok) {
    const body = await channelRes.text();
    console.error("[youtube/callback] channel fetch failed:", channelRes.status, body);
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_channel_failed", req.url)
    );
  }

  const channelData = await channelRes.json();
  const channel = channelData?.items?.[0];

  if (!channel) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=youtube_no_channel", req.url)
    );
  }

  const channelId = channel.id as string;
  const channelName = channel.snippet?.title ?? channelId;
  const expiresAt = expires_in
    ? new Date(Date.now() + (expires_in as number) * 1000)
    : null;

  await prisma.socialAccount.upsert({
    where: { platform_platformId: { platform: "YOUTUBE", platformId: channelId } },
    create: {
      userId: session.user.id,
      platform: "YOUTUBE",
      platformId: channelId,
      username: channelName,
      accessToken: encryptToken(access_token),
      refreshToken: refresh_token ? encryptToken(refresh_token) : null,
      expiresAt,
    },
    update: {
      userId: session.user.id,
      username: channelName,
      accessToken: encryptToken(access_token),
      refreshToken: refresh_token ? encryptToken(refresh_token) : null,
      expiresAt,
    },
  });

  return NextResponse.redirect(
    new URL("/dashboard/accounts?success=youtube_connected", req.url)
  );
}
