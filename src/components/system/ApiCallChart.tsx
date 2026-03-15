"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { ApiBucket } from "./types";

interface ApiCallChartProps {
  buckets: ApiBucket[];
}

const SERVICE_COLORS: Record<string, string> = {
  blotato: "#8b5cf6", // violet
  github: "#34d399", // emerald
  anthropic: "#fbbf24", // amber
};

function formatTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Pivot bucket rows into one row per timestamp with a column per service.
 */
function pivotData(buckets: ApiBucket[]) {
  const map = new Map<string, Record<string, string | number>>();
  const services = new Set<string>();

  for (const b of buckets) {
    services.add(b.service);
    const row = map.get(b.timestamp) ?? { timestamp: b.timestamp };
    row[b.service] = ((row[b.service] as number) ?? 0) + b.count;
    map.set(b.timestamp, row);
  }

  const rows = Array.from(map.values()).sort(
    (a, b) =>
      new Date(a.timestamp as string).getTime() -
      new Date(b.timestamp as string).getTime()
  );

  return { rows, services: Array.from(services) };
}

export function ApiCallChart({ buckets }: ApiCallChartProps) {
  if (buckets.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-12">
        No API calls recorded yet
      </p>
    );
  }

  const { rows, services } = pivotData(buckets);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows}>
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
            labelFormatter={(label) => formatTime(String(label))}
            labelStyle={{ color: "#e4e4e7" }}
          />
          <Legend />
          {services.map((service) => (
            <Area
              key={service}
              type="monotone"
              dataKey={service}
              stroke={SERVICE_COLORS[service] ?? "#71717a"}
              fill={SERVICE_COLORS[service] ?? "#71717a"}
              fillOpacity={0.15}
              strokeWidth={2}
              name={service}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
