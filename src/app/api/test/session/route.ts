// Test-only endpoint: mints a NextAuth JWT session cookie for Playwright E2E tests.
// Returns 404 in all non-test environments — never reachable in production.
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { env } from "@/env";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // next dev forces NODE_ENV="development", so we use a dedicated flag instead.
  if (!process.env.PLAYWRIGHT_E2E) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const email = new URL(req.url).searchParams.get("email");
  if (!email) {
    return NextResponse.json({ error: "Missing email" }, { status: 400 });
  }

  // Validate against ALLOWED_EMAILS (same check as real sign-in)
  const allowed = env.ALLOWED_EMAILS.split(",").map((e) => e.trim().toLowerCase());
  if (!allowed.includes(email.toLowerCase())) {
    return NextResponse.json({ error: "Email not allowed" }, { status: 403 });
  }

  // Upsert test user so session.user.id resolves to a real DB row
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Test User" },
    update: {},
  });

  // Mint a JWT using the same secret and structure as NextAuth's JWT callback.
  // The JWT callback puts user.id into token.sub; the session callback reads it back.
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name },
    secret: env.NEXTAUTH_SECRET,
    maxAge: 60 * 60 * 24, // 1 day
  });

  // Cookie name: NextAuth uses "next-auth.session-token" over HTTP (localhost).
  // Over HTTPS it would be "__Secure-next-auth.session-token" — not needed for tests.
  const response = NextResponse.json({ ok: true, userId: user.id });
  response.cookies.set("next-auth.session-token", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    // No `secure: true` — tests run over http://localhost
    maxAge: 60 * 60 * 24,
  });
  return response;
}
