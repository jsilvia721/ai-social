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

  // Summary by service
  const groupedResults = await prisma.apiCall.groupBy({
    by: ["service"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _avg: { latencyMs: true },
  });

  const byService: Record<
    string,
    { count: number; avgLatencyMs: number }
  > = {};
  let totalCalls = 0;
  let totalLatency = 0;

  for (const row of groupedResults) {
    const count = row._count._all;
    const avgLatency = row._avg.latencyMs ?? 0;
    byService[row.service] = { count, avgLatencyMs: Math.round(avgLatency) };
    totalCalls += count;
    totalLatency += avgLatency * count;
  }

  // Time-series bucketing
  const rows = await prisma.apiCall.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });

  const bucketMap = new Map<
    string,
    { count: number; totalLatency: number; errorCount: number; service: string }
  >();

  let totalErrors = 0;

  for (const row of rows) {
    const bucketTime = new Date(
      Math.floor(row.createdAt.getTime() / bucketSize) * bucketSize
    );
    const key = `${bucketTime.toISOString()}|${row.service}`;

    const bucket = bucketMap.get(key) ?? {
      count: 0,
      totalLatency: 0,
      errorCount: 0,
      service: row.service,
    };

    bucket.count++;
    bucket.totalLatency += row.latencyMs;
    if (row.error || (row.statusCode && row.statusCode >= 400)) {
      bucket.errorCount++;
      totalErrors++;
    }

    bucketMap.set(key, bucket);
  }

  const buckets = Array.from(bucketMap.entries()).map(([key, data]) => ({
    timestamp: key.split("|")[0],
    service: data.service,
    count: data.count,
    avgLatencyMs: Math.round(data.totalLatency / data.count),
    errorCount: data.errorCount,
  }));

  return NextResponse.json({
    buckets,
    summary: {
      totalCalls,
      avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
      byService,
    },
  });
}
