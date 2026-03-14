import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VALID_RANGES, DURATION_MS, BUCKET_MS } from "@/lib/system/shared";
import type { Range } from "@/lib/system/shared";
import { TimeRangeToggle } from "@/components/system/TimeRangeToggle";
import { SystemStatusCards } from "@/components/system/SystemStatusCards";
import { ApiCallChart } from "@/components/system/ApiCallChart";
import { CronRunTimeline } from "@/components/system/CronRunTimeline";
import { ErrorTrendChart } from "@/components/system/ErrorTrendChart";
import type { ApiBucket, CronRunRow, CronStatusInfo, ErrorBucket, TopError } from "@/components/system/types";

function isValidRange(value: string): value is Range {
  return (VALID_RANGES as readonly string[]).includes(value);
}

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SystemPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user.isAdmin) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const rangeParam = typeof params.range === "string" ? params.range : "24h";
  const range: Range = isValidRange(rangeParam) ? rangeParam : "24h";
  // eslint-disable-next-line react-hooks/purity -- server component; fresh timestamp required per request
  const since = new Date(Date.now() - DURATION_MS[range]);
  const bucketSize = BUCKET_MS[range];

  // Fetch all data in parallel, each with independent error handling
  const [apiCallsResult, cronRunsResult, errorsResult] = await Promise.all([
    fetchApiCalls(since, bucketSize),
    fetchCronRuns(since),
    fetchErrors(since, bucketSize),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">System Health</h1>
          <p className="text-zinc-400 mt-1">
            Monitor cron jobs, API calls, and error trends.
          </p>
        </div>
        <TimeRangeToggle />
      </div>

      {/* Cron Status Cards */}
      <section>
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">
          Cron Health
        </h2>
        {!cronRunsResult.ok ? (
          <p className="text-red-400 text-sm">
            Failed to load cron status.
          </p>
        ) : (
          <SystemStatusCards crons={cronRunsResult.cronStatuses} />
        )}
      </section>

      {/* API Call Volume */}
      <section>
        <Card className="bg-zinc-800 border-zinc-700">
          <CardHeader>
            <CardTitle className="text-zinc-200">API Call Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {!apiCallsResult.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load API call data.
              </p>
            ) : (
              <ApiCallChart buckets={apiCallsResult.buckets} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Recent Cron Runs */}
      <section>
        <Card className="bg-zinc-800 border-zinc-700">
          <CardHeader>
            <CardTitle className="text-zinc-200">Recent Cron Runs</CardTitle>
          </CardHeader>
          <CardContent>
            {!cronRunsResult.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load cron run data.
              </p>
            ) : (
              <CronRunTimeline runs={cronRunsResult.runs} />
            )}
          </CardContent>
        </Card>
      </section>

      {/* Error Trends */}
      <section>
        <Card className="bg-zinc-800 border-zinc-700">
          <CardHeader>
            <CardTitle className="text-zinc-200">Error Trends</CardTitle>
          </CardHeader>
          <CardContent>
            {!errorsResult.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load error data.
              </p>
            ) : (
              <ErrorTrendChart
                buckets={errorsResult.buckets}
                topErrors={errorsResult.topErrors}
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// --- Data fetching helpers with independent error handling ---

async function fetchApiCalls(
  since: Date,
  bucketSize: number
): Promise<{ ok: true; buckets: ApiBucket[] } | { ok: false; error: string }> {
  try {
    const rows = await prisma.apiCall.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 10_000,
      select: {
        service: true,
        latencyMs: true,
        statusCode: true,
        error: true,
        createdAt: true,
      },
    });

    const bucketMap = new Map<
      string,
      { count: number; totalLatency: number; errorCount: number; service: string }
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

    return { ok: true, buckets };
  } catch {
    return { ok: false, error: "Failed to fetch API call data" };
  }
}

async function fetchCronRuns(
  since: Date
): Promise<
  | { ok: true; runs: CronRunRow[]; cronStatuses: CronStatusInfo[] }
  | { ok: false; error: string }
> {
  try {
    const runs = await prisma.cronRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
      take: 5_000,
      select: {
        id: true,
        cronName: true,
        status: true,
        itemsProcessed: true,
        durationMs: true,
        startedAt: true,
      },
    });

    const cronMap: Record<
      string,
      { lastRunAt: string | null; successCount: number; total: number }
    > = {};

    const serializedRuns: CronRunRow[] = runs.map((run) => {
      if (!cronMap[run.cronName]) {
        cronMap[run.cronName] = { lastRunAt: null, successCount: 0, total: 0 };
      }
      const group = cronMap[run.cronName];
      group.total++;
      if (run.status === "SUCCESS") group.successCount++;
      if (!group.lastRunAt || run.startedAt.toISOString() > group.lastRunAt) {
        group.lastRunAt = run.startedAt.toISOString();
      }

      return {
        id: run.id,
        cronName: run.cronName,
        status: run.status as CronRunRow["status"],
        itemsProcessed: run.itemsProcessed,
        durationMs: run.durationMs,
        startedAt: run.startedAt.toISOString(),
      };
    });

    const cronStatuses: CronStatusInfo[] = Object.entries(cronMap).map(
      ([cronName, data]) => ({
        cronName,
        lastRunAt: data.lastRunAt,
        successRate: data.total > 0 ? data.successCount / data.total : 0,
      })
    );

    return { ok: true, runs: serializedRuns, cronStatuses };
  } catch {
    return { ok: false, error: "Failed to fetch cron run data" };
  }
}

async function fetchErrors(
  since: Date,
  bucketSize: number
): Promise<
  | { ok: true; buckets: ErrorBucket[]; topErrors: TopError[] }
  | { ok: false; error: string }
> {
  try {
    const errors = await prisma.errorReport.findMany({
      where: { lastSeenAt: { gte: since } },
      orderBy: { lastSeenAt: "desc" },
      take: 5_000,
      select: {
        message: true,
        source: true,
        count: true,
        status: true,
        lastSeenAt: true,
      },
    });

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

    const topErrors = [...errors]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((e) => ({
        message: e.message,
        count: e.count,
        lastSeenAt: e.lastSeenAt.toISOString(),
        status: e.status as TopError["status"],
        source: e.source,
      }));

    return { ok: true, buckets, topErrors };
  } catch {
    return { ok: false, error: "Failed to fetch error data" };
  }
}
