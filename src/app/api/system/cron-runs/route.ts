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

  const runs = await prisma.cronRun.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
  });

  // Group by cronName
  const cronMap: Record<
    string,
    {
      runs: typeof runs;
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
    group.runs.push(run);

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
      runs: typeof runs;
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
      lastRunAt: data.runs[0]?.startedAt.toISOString() ?? null,
      avgDurationMs:
        data.durationCount > 0
          ? Math.round(data.totalDuration / data.durationCount)
          : 0,
    };
  }

  return NextResponse.json({ crons });
}
