"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CronRunRow } from "./types";

interface CronRunTimelineProps {
  runs: CronRunRow[];
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export function CronRunTimeline({ runs }: CronRunTimelineProps) {
  if (runs.length === 0) {
    return (
      <p className="text-zinc-500 text-center py-12">
        No cron runs recorded yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-700 text-left text-zinc-400">
            <th className="pb-3 pr-4 font-medium">Cron Name</th>
            <th className="pb-3 pr-4 font-medium">Status</th>
            <th className="pb-3 pr-4 font-medium">Duration</th>
            <th className="pb-3 pr-4 font-medium">Items</th>
            <th className="pb-3 font-medium">Started At</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {runs.map((run) => (
            <tr key={run.id} className="text-zinc-200">
              <td className="py-3 pr-4 capitalize">{run.cronName}</td>
              <td className="py-3 pr-4">
                <Badge
                  className={cn(
                    "text-xs",
                    run.status === "SUCCESS"
                      ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : run.status === "FAILED"
                        ? "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                        : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                  )}
                >
                  {run.status}
                </Badge>
              </td>
              <td className="py-3 pr-4 text-zinc-400">
                {formatDuration(run.durationMs)}
              </td>
              <td className="py-3 pr-4 text-zinc-400">
                {run.itemsProcessed ?? "-"}
              </td>
              <td className="py-3 text-zinc-400">{formatDate(run.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
