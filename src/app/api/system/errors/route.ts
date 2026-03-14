import { prisma } from "@/lib/db";
import { requireAdmin, parseRange, BUCKET_MS } from "@/lib/system/shared";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rangeResult = parseRange(req);
  if ("error" in rangeResult) return rangeResult.error;

  const { range, since } = rangeResult;
  const bucketSize = BUCKET_MS[range];

  try {
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
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
