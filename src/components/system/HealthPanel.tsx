import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeRangeToggle } from "@/components/system/TimeRangeToggle";
import { SystemStatusCards } from "@/components/system/SystemStatusCards";
import { ApiCallChart } from "@/components/system/ApiCallChart";
import { CronRunTimeline } from "@/components/system/CronRunTimeline";
import { ErrorTrendChart } from "@/components/system/ErrorTrendChart";
import type {
  ApiBucket,
  CronRunRow,
  CronStatusInfo,
  ErrorBucket,
  TopError,
} from "@/components/system/types";

interface HealthPanelProps {
  apiCalls: { ok: true; buckets: ApiBucket[] } | { ok: false };
  cronRuns:
    | { ok: true; runs: CronRunRow[]; cronStatuses: CronStatusInfo[] }
    | { ok: false };
  errors:
    | { ok: true; buckets: ErrorBucket[]; topErrors: TopError[] }
    | { ok: false };
}

export function HealthPanel({ apiCalls, cronRuns, errors }: HealthPanelProps) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-200">
            System Health Overview
          </h2>
          <p className="text-zinc-400 text-sm mt-1">
            Monitor cron jobs, API calls, and error trends.
          </p>
        </div>
        <TimeRangeToggle />
      </div>

      {/* Cron Status Cards */}
      <section>
        <h3 className="text-base font-semibold text-zinc-200 mb-4">
          Cron Health
        </h3>
        {!cronRuns.ok ? (
          <p className="text-red-400 text-sm">Failed to load cron status.</p>
        ) : (
          <SystemStatusCards crons={cronRuns.cronStatuses} />
        )}
      </section>

      {/* API Call Volume */}
      <section>
        <Card className="bg-zinc-800 border-zinc-700">
          <CardHeader>
            <CardTitle className="text-zinc-200">API Call Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {!apiCalls.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load API call data.
              </p>
            ) : (
              <ApiCallChart buckets={apiCalls.buckets} />
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
            {!cronRuns.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load cron run data.
              </p>
            ) : (
              <CronRunTimeline runs={cronRuns.runs} />
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
            {!errors.ok ? (
              <p className="text-red-400 text-sm">
                Failed to load error data.
              </p>
            ) : (
              <ErrorTrendChart
                buckets={errors.buckets}
                topErrors={errors.topErrors}
              />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
