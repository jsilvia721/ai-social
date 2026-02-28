import { NextRequest, NextResponse } from "next/server";
import { runScheduler } from "@/lib/scheduler";

// Called by Vercel Cron or any external trigger — validates CRON_SECRET when set
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const data = await runScheduler();
  return NextResponse.json(data);
}

// Available for manual triggering (e.g. local dev, integration tests)
export async function POST(_req: NextRequest) {
  const data = await runScheduler();
  return NextResponse.json(data);
}
