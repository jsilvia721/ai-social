import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getConnectUrl } from "@/lib/blotato/accounts";
import { env } from "@/env";
import { NextRequest, NextResponse } from "next/server";

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

  const membership = await prisma.businessMember.findFirst({
    where: { userId: session.user.id, businessId },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = Buffer.from(
    JSON.stringify({ userId: session.user.id, businessId })
  ).toString("base64url");

  const callbackUrl = `${env.NEXTAUTH_URL}/api/connect/blotato/callback`;

  const { url } = await getConnectUrl(platform, callbackUrl, state);

  return NextResponse.redirect(url, 302);
}
