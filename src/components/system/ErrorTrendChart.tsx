"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ErrorBucket {
  timestamp: string;
  source: string;
  count: number;
  errorCount: number;
}

interface TopError {
  message: string;
  count: number;
  lastSeenAt: string;
  status: string;
  source: string;
}

interface ErrorTrendChartProps {
  buckets: ErrorBucket[];
  topErrors: TopError[];
}

const SOURCE_COLORS: Record<string, string> = {
  SERVER: "#f87171", // red
  CLIENT: "#fb923c", // orange
};

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  });
}

function pivotData(buckets: ErrorBucket[]) {
  const map = new Map<string, Record<string, number>>();
  const sources = new Set<string>();

  for (const b of buckets) {
    sources.add(b.source);
    const row = map.get(b.timestamp) ?? { timestamp: b.timestamp };
    row[b.source] = (row[b.source] ?? 0) + b.count;
    map.set(b.timestamp, row);
  }

  const rows = Array.from(map.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  return { rows, sources: Array.from(sources) };
}

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-red-500/10 text-red-400",
  ISSUE_CREATED: "bg-amber-500/10 text-amber-400",
  RESOLVED: "bg-emerald-500/10 text-emerald-400",
  IGNORED: "bg-zinc-500/10 text-zinc-400",
};

export function ErrorTrendChart({ buckets, topErrors }: ErrorTrendChartProps) {
  if (buckets.length === 0 && topErrors.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-12">
        No errors recorded yet
      </p>
    );
  }

  const { rows, sources } = pivotData(buckets);

  return (
    <div className="space-y-6">
      {rows.length > 0 && (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                stroke="#71717a"
                fontSize={12}
              />
              <YAxis stroke="#71717a" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#18181b",
                  border: "1px solid #3f3f46",
                  borderRadius: "8px",
                }}
                labelFormatter={formatTime}
                labelStyle={{ color: "#e4e4e7" }}
              />
              <Legend />
              {sources.map((source) => (
                <Line
                  key={source}
                  type="monotone"
                  dataKey={source}
                  stroke={SOURCE_COLORS[source] ?? "#71717a"}
                  strokeWidth={2}
                  dot={false}
                  name={source}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {topErrors.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300 mb-3">
            Top Errors
          </h3>
          <div className="space-y-2">
            {topErrors.map((error, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-200 truncate">
                    {error.message}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge
                      className={cn(
                        "text-xs",
                        STATUS_STYLES[error.status] ?? STATUS_STYLES.NEW
                      )}
                    >
                      {error.status}
                    </Badge>
                    <span className="text-xs text-zinc-500">
                      {error.source}
                    </span>
                  </div>
                </div>
                <span className="text-sm font-medium text-zinc-300 shrink-0">
                  {error.count}x
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
