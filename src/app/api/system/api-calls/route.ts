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
    // Single query — derive both summary and time-series buckets
    const rows = await prisma.apiCall.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        service: true,
        latencyMs: true,
        statusCode: true,
        error: true,
        createdAt: true,
      },
    });

    // Summary by service
    const byService: Record<
      string,
      { count: number; totalLatency: number }
    > = {};
    let totalErrors = 0;

    for (const row of rows) {
      if (!byService[row.service]) {
        byService[row.service] = { count: 0, totalLatency: 0 };
      }
      byService[row.service].count++;
      byService[row.service].totalLatency += row.latencyMs;
      if (row.error || (row.statusCode && row.statusCode >= 400)) {
        totalErrors++;
      }
    }

    const totalCalls = rows.length;
    const totalLatency = Object.values(byService).reduce(
      (sum, s) => sum + s.totalLatency,
      0
    );

    const summaryByService: Record<
      string,
      { count: number; avgLatencyMs: number }
    > = {};
    for (const [service, data] of Object.entries(byService)) {
      summaryByService[service] = {
        count: data.count,
        avgLatencyMs: Math.round(data.totalLatency / data.count),
      };
    }

    // Time-series bucketing
    const bucketMap = new Map<
      string,
      {
        count: number;
        totalLatency: number;
        errorCount: number;
        service: string;
      }
    >();

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
        avgLatencyMs:
          totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
        errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
        byService: summaryByService,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
