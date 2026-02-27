import { env } from "@/env";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const GRAPH_URL = "https://graph.facebook.com/v19.0";

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
      new URL("/dashboard/accounts?error=meta_denied", req.url)
    );
  }

  // Verify state cookie
  const cookieStore = await cookies();
  const savedState = cookieStore.get("meta_oauth_state")?.value;
  cookieStore.delete("meta_oauth_state");

  if (!savedState || state !== savedState || !code) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=state_mismatch", req.url)
    );
  }

  // Step 1: Exchange code for short-lived User Access Token
  const shortTokenRes = await fetch(`${GRAPH_URL}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: `${env.NEXTAUTH_URL}/api/connect/meta/callback`,
      code,
    }),
  });

  if (!shortTokenRes.ok) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=meta_token_failed", req.url)
    );
  }

  const { access_token: shortLivedToken } = await shortTokenRes.json();

  // Step 2: Exchange for 60-day long-lived User Access Token
  const longTokenRes = await fetch(
    `${GRAPH_URL}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: shortLivedToken,
    })}`
  );

  if (!longTokenRes.ok) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=meta_long_token_failed", req.url)
    );
  }

  const { access_token: longLivedToken } = await longTokenRes.json();

  // Step 3: Fetch all Pages the user manages
  // Each page has its own Page Access Token that never expires
  // when derived from a long-lived User Access Token
  const pagesRes = await fetch(
    `${GRAPH_URL}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longLivedToken}`
  );

  if (!pagesRes.ok) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=meta_pages_failed", req.url)
    );
  }

  const { data: pages } = await pagesRes.json();

  if (!pages || pages.length === 0) {
    return NextResponse.redirect(
      new URL("/dashboard/accounts?error=no_pages_found", req.url)
    );
  }

  // Step 4: Build upsert operations for all Facebook Pages and linked Instagram accounts
  type UpsertOp = Parameters<typeof prisma.socialAccount.upsert>[0];
  const upsertOps: UpsertOp[] = [];

  for (const page of pages) {
    // Facebook Page account (Page Access Tokens don't expire)
    upsertOps.push({
      where: {
        platform_platformId: { platform: "FACEBOOK", platformId: page.id },
      },
      create: {
        userId: session.user.id,
        platform: "FACEBOOK",
        platformId: page.id,
        username: page.name,
        accessToken: page.access_token,
        refreshToken: null,
        expiresAt: null,
      },
      update: {
        userId: session.user.id,
        username: page.name,
        accessToken: page.access_token,
        expiresAt: null,
      },
    });

    // Instagram Business Account linked to this page (if any)
    if (page.instagram_business_account?.id) {
      const igRes = await fetch(
        `${GRAPH_URL}/${page.instagram_business_account.id}?fields=id,username&access_token=${page.access_token}`
      );

      if (igRes.ok) {
        const igData = await igRes.json();
        upsertOps.push({
          where: {
            platform_platformId: {
              platform: "INSTAGRAM",
              platformId: igData.id,
            },
          },
          create: {
            userId: session.user.id,
            platform: "INSTAGRAM",
            platformId: igData.id,
            username: igData.username,
            accessToken: page.access_token, // Instagram Graph API uses the Page token
            refreshToken: null,
            expiresAt: null,
          },
          update: {
            userId: session.user.id,
            username: igData.username,
            accessToken: page.access_token,
            expiresAt: null,
          },
        });
      }
    }
  }

  // Step 5: Execute all upserts in a single transaction
  await prisma.$transaction(upsertOps.map((op) => prisma.socialAccount.upsert(op)));

  return NextResponse.redirect(
    new URL("/dashboard/accounts?success=meta_connected", req.url)
  );
}
