import { env } from "@/env";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "crypto";

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");

  const cookieStore = await cookies();
  cookieStore.set("twitter_oauth_state", JSON.stringify({ state, codeVerifier }), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300, // 5 minutes
    path: "/",
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.TWITTER_CLIENT_ID,
    redirect_uri: `${env.NEXTAUTH_URL}/api/connect/twitter/callback`,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(
    `https://twitter.com/i/oauth2/authorize?${params.toString()}`
  );
}
