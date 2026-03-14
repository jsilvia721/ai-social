import { prisma } from "@/lib/db";
import { requireAdmin, parseRange } from "@/lib/system/shared";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const rangeResult = parseRange(req);
  if ("error" in rangeResult) return rangeResult.error;

  const { since } = rangeResult;

  try {
    const runs = await prisma.cronRun.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: "desc" },
    });

    // Group by cronName in a single pass
    const cronMap: Record<
      string,
      {
        runs: {
          id: string;
          cronName: string;
          status: string;
          itemsProcessed: number | null;
          durationMs: number | null;
          error: string | null;
          startedAt: string;
          completedAt: string | null;
        }[];
        successCount: number;
        totalDuration: number;
        durationCount: number;
      }
    > = {};

    for (const run of runs) {
      if (!cronMap[run.cronName]) {
        cronMap[run.cronName] = {
          runs: [],
          successCount: 0,
          totalDuration: 0,
          durationCount: 0,
        };
      }

      const group = cronMap[run.cronName];

      // Map to explicit response shape (avoid leaking raw Prisma objects)
      group.runs.push({
        id: run.id,
        cronName: run.cronName,
        status: run.status,
        itemsProcessed: run.itemsProcessed,
        durationMs: run.durationMs,
        error: run.error,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      });

      if (run.status === "SUCCESS") {
        group.successCount++;
      }

      if (run.durationMs != null) {
        group.totalDuration += run.durationMs;
        group.durationCount++;
      }
    }

    const crons: Record<
      string,
      {
        runs: typeof cronMap[string]["runs"];
        successRate: number;
        lastRunAt: string | null;
        avgDurationMs: number;
      }
    > = {};

    for (const [name, data] of Object.entries(cronMap)) {
      crons[name] = {
        runs: data.runs,
        successRate:
          data.runs.length > 0 ? data.successCount / data.runs.length : 0,
        lastRunAt: data.runs[0]?.startedAt ?? null,
        avgDurationMs:
          data.durationCount > 0
            ? Math.round(data.totalDuration / data.durationCount)
            : 0,
      };
    }

    return NextResponse.json({ crons });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
