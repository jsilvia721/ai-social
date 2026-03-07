import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAccount } from "@/lib/blotato/accounts";
import type { Platform } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const ACCOUNTS_URL = "/dashboard/accounts";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state");
  const accountId = searchParams.get("accountId");

  if (!state || !accountId) {
    return NextResponse.json({ error: "state and accountId are required" }, { status: 400 });
  }

  // Decode state
  let stateData: { userId: string; businessId: string };
  try {
    stateData = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/auth/signin", req.url), 302);
  }

  if (session.user.id !== stateData.userId) {
    return NextResponse.json({ error: "State mismatch" }, { status: 403 });
  }

  try {
    const account = await getAccount(accountId);
    const platform = account.platform as Platform;
    const platformId = account.platformId ?? accountId;

    await prisma.socialAccount.upsert({
      where: {
        platform_platformId: { platform, platformId },
      },
      create: {
        businessId: stateData.businessId,
        blotatoAccountId: accountId,
        platform,
        platformId,
        username: account.username,
      },
      update: {
        blotatoAccountId: accountId,
        username: account.username,
      },
    });
  } catch (err) {
    console.error("[blotato-callback] failed to save account:", err);
    return NextResponse.redirect(
      new URL(`${ACCOUNTS_URL}?error=connect`, req.url),
      302
    );
  }

  return NextResponse.redirect(new URL(ACCOUNTS_URL, req.url), 302);
}
