import { env } from "@/env";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

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
      new URL("/dashboard/accounts?error=twitter_denied", req.url)
    );
  }

  // Read and verify state cookie
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("twitter_oauth_state");
  if (!stateCookie || !code) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=state_missing", req.url)
    );
  }

  const { state: savedState, codeVerifier } = JSON.parse(stateCookie.value);

  // CSRF check
  if (state !== savedState) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=state_mismatch", req.url)
    );
  }

  // Clear state cookie immediately after validation
  cookieStore.delete("twitter_oauth_state");

  // Exchange code for tokens
  const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${env.TWITTER_CLIENT_ID}:${env.TWITTER_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.NEXTAUTH_URL}/api/connect/twitter/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=token_exchange_failed", req.url)
    );
  }

  const { access_token, refresh_token, expires_in } = await tokenRes.json();

  // Fetch Twitter user identity
  const userRes = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=user_fetch_failed", req.url)
    );
  }

  const { data: twitterUser } = await userRes.json();

  await prisma.socialAccount.upsert({
    where: {
      platform_platformId: {
        platform: "TWITTER",
        platformId: twitterUser.id,
      },
    },
    create: {
      userId: session.user.id,
      platform: "TWITTER",
      platformId: twitterUser.id,
      username: twitterUser.username,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    },
    update: {
      userId: session.user.id,
      username: twitterUser.username,
      accessToken: access_token,
      refreshToken: refresh_token ?? null,
      expiresAt: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    },
  });

  return NextResponse.redirect(
    new URL("/dashboard/accounts?success=twitter_connected", req.url)
  );
}
