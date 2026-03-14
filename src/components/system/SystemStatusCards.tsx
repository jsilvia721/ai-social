"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CronStatus {
  cronName: string;
  lastRunAt: string | null;
  successRate: number;
}

interface SystemStatusCardsProps {
  crons: CronStatus[];
}

type HealthLevel = "healthy" | "degraded" | "down" | "unknown";

const HEALTH_STYLES: Record<HealthLevel, string> = {
  healthy: "bg-emerald-500/10 text-emerald-400 border-emerald-700",
  degraded: "bg-amber-500/10 text-amber-400 border-amber-700",
  down: "bg-red-500/10 text-red-400 border-red-700",
  unknown: "bg-zinc-500/10 text-zinc-400 border-zinc-700",
};

const HEALTH_LABELS: Record<HealthLevel, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

// Thresholds in ms
const PUBLISH_DEGRADED = 5 * 60 * 1000; // 5 min
const PUBLISH_DOWN = 15 * 60 * 1000; // 15 min
const HOURLY_DEGRADED = 90 * 60 * 1000; // 90 min
const HOURLY_DOWN = 3 * 60 * 60 * 1000; // 3 hours
const WEEKLY_DEGRADED = 8 * 24 * 60 * 60 * 1000; // 8 days
const WEEKLY_DOWN = 14 * 24 * 60 * 60 * 1000; // 14 days

const PUBLISH_CRONS = ["publish"];
const WEEKLY_CRONS = ["optimize", "brainstorm"];

export function getHealthLevel(cronName: string, lastRunAt: string | null): HealthLevel {
  if (!lastRunAt) return "unknown";

  const staleness = Date.now() - new Date(lastRunAt).getTime();

  if (PUBLISH_CRONS.includes(cronName)) {
    if (staleness > PUBLISH_DOWN) return "down";
    if (staleness > PUBLISH_DEGRADED) return "degraded";
    return "healthy";
  }

  if (WEEKLY_CRONS.includes(cronName)) {
    if (staleness > WEEKLY_DOWN) return "down";
    if (staleness > WEEKLY_DEGRADED) return "degraded";
    return "healthy";
  }

  // Default: hourly crons (metrics, research, briefs, fulfill)
  if (staleness > HOURLY_DOWN) return "down";
  if (staleness > HOURLY_DEGRADED) return "degraded";
  return "healthy";
}

function formatStaleness(lastRunAt: string | null): string {
  if (!lastRunAt) return "Never";
  const ms = Date.now() - new Date(lastRunAt).getTime();
  if (ms < 60_000) return "Just now";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

export function SystemStatusCards({ crons }: SystemStatusCardsProps) {
  if (crons.length === 0) {
    return <p className="text-zinc-500 text-sm">No cron status data available.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {crons.map((cron) => {
        const health = getHealthLevel(cron.cronName, cron.lastRunAt);
        return (
          <Card
            key={cron.cronName}
            className={cn("border", HEALTH_STYLES[health])}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium capitalize">
                {cron.cronName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="text-lg font-bold">{HEALTH_LABELS[health]}</p>
              <p className="text-xs opacity-70">
                Last run: {formatStaleness(cron.lastRunAt)}
              </p>
              <p className="text-xs opacity-70">
                Success rate: {(cron.successRate * 100).toFixed(0)}%
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
