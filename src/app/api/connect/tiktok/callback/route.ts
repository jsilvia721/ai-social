import { env } from "@/env";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const TIKTOK_USER_URL = "https://open.tiktokapis.com/v2/user/info/";

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
      new URL("/dashboard/accounts?error=tiktok_denied", req.url)
    );
  }

  const cookieStore = await cookies();
  const rawCookie = cookieStore.get("tiktok_oauth_state")?.value;
  cookieStore.delete("tiktok_oauth_state");

  if (!rawCookie || !code) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=tiktok_state_missing", req.url)
    );
  }

  let savedState: string;
  let codeVerifier: string;
  try {
    ({ state: savedState, codeVerifier } = JSON.parse(rawCookie));
  } catch {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=tiktok_state_invalid", req.url)
    );
  }

  if (state !== savedState) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=tiktok_state_mismatch", req.url)
    );
  }

  // Exchange authorization code for access token
  const tokenRes = await fetch(TIKTOK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_ID,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${env.NEXTAUTH_URL}/api/connect/tiktok/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    console.error("[tiktok/callback] token exchange failed:", tokenRes.status, body);
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=tiktok_token_failed", req.url)
    );
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, open_id } = tokenData;

  // Fetch TikTok user info to get display name
  const userRes = await fetch(
    `${TIKTOK_USER_URL}?fields=open_id,display_name`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  let username = open_id as string;
  if (userRes.ok) {
    const userData = await userRes.json();
    username = userData?.data?.user?.display_name ?? open_id;
  }

  const expiresAt = expires_in
    ? new Date(Date.now() + (expires_in as number) * 1000)
    : null;

  await prisma.socialAccount.upsert({
    where: { platform_platformId: { platform: "TIKTOK", platformId: open_id } },
    create: {
      userId: session.user.id,
      platform: "TIKTOK",
      platformId: open_id,
      username,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      expiresAt,
    },
    update: {
      userId: session.user.id,
      username,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      expiresAt,
    },
  });

  return NextResponse.redirect(
    new URL("/dashboard/accounts?success=tiktok_connected", req.url)
  );
}
