import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

const VALID_RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof VALID_RANGES)[number];

const DURATION_MS: Record<Range, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const BUCKET_MS: Record<Range, number> = {
  "24h": 60 * 60 * 1000, // 1 hour
  "7d": 4 * 60 * 60 * 1000, // 4 hours
  "30d": 24 * 60 * 60 * 1000, // 1 day
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const range = (req.nextUrl.searchParams.get("range") ?? "24h") as string;
  if (!VALID_RANGES.includes(range as Range)) {
    return NextResponse.json(
      { error: "Invalid range. Must be one of: 24h, 7d, 30d" },
      { status: 400 }
    );
  }

  const validRange = range as Range;
  const since = new Date(Date.now() - DURATION_MS[validRange]);
  const bucketSize = BUCKET_MS[validRange];

  const errors = await prisma.errorReport.findMany({
    where: { lastSeenAt: { gte: since } },
    orderBy: { lastSeenAt: "desc" },
  });

  // Bucket by source + time
  const bucketMap = new Map<
    string,
    { count: number; errorCount: number; source: string }
  >();

  for (const error of errors) {
    const bucketTime = new Date(
      Math.floor(error.lastSeenAt.getTime() / bucketSize) * bucketSize
    );
    const key = `${bucketTime.toISOString()}|${error.source}`;

    const bucket = bucketMap.get(key) ?? {
      count: 0,
      errorCount: 0,
      source: error.source,
    };

    bucket.count += error.count;
    bucket.errorCount++;
    bucketMap.set(key, bucket);
  }

  const buckets = Array.from(bucketMap.entries()).map(([key, data]) => ({
    timestamp: key.split("|")[0],
    source: data.source,
    count: data.count,
    errorCount: data.errorCount,
  }));

  // Top 10 errors by count
  const topErrors = [...errors]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((e) => ({
      message: e.message,
      count: e.count,
      lastSeenAt: e.lastSeenAt.toISOString(),
      status: e.status,
      source: e.source,
    }));

  return NextResponse.json({ buckets, topErrors });
}
