import { authOptions } from "@/lib/auth";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

export const VALID_RANGES = ["24h", "7d", "30d"] as const;
export type Range = (typeof VALID_RANGES)[number];

export const DURATION_MS: Record<Range, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export const BUCKET_MS: Record<Range, number> = {
  "24h": 60 * 60 * 1000, // 1 hour
  "7d": 4 * 60 * 60 * 1000, // 4 hours
  "30d": 24 * 60 * 60 * 1000, // 1 day
};

function isValidRange(value: string): value is Range {
  return (VALID_RANGES as readonly string[]).includes(value);
}

/**
 * Validates admin session. Returns the session on success, or an error NextResponse.
 */
export async function requireAdmin(): Promise<
  | { session: Session }
  | { error: NextResponse }
> {
  const session = await getServerSession(authOptions);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!session.user.isAdmin) {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

/**
 * Parses and validates range query param. Returns the Range on success,
 * or an error NextResponse on invalid input.
 */
export function parseRange(
  req: NextRequest
): { range: Range; since: Date } | { error: NextResponse } {
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "24h";
  if (!isValidRange(rangeParam)) {
    return {
      error: NextResponse.json(
        { error: "Invalid range. Must be one of: 24h, 7d, 30d" },
        { status: 400 }
      ),
    };
  }
  return {
    range: rangeParam,
    since: new Date(Date.now() - DURATION_MS[rangeParam]),
  };
}
