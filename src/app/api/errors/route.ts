import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const errorReportSchema = z.object({
  message: z.string().min(1).max(1000),
  stack: z.string().max(10000).optional(),
  source: z.enum(["SERVER", "CLIENT"]),
  url: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = errorReportSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { message, stack, source, url, metadata } = parsed.data;

  const fingerprint = crypto
    .createHash("sha256")
    .update(source + ":" + message)
    .digest("hex");

  try {
    const report = await prisma.errorReport.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        message,
        stack,
        source,
        url,
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: new Date(),
        stack,
      },
    });

    const status = report.count === 1 ? 201 : 200;

    return NextResponse.json(
      { id: report.id, fingerprint: report.fingerprint, count: report.count },
      { status }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to record error report" },
      { status: 500 }
    );
  }
}
