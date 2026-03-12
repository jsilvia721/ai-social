import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

const errorReportSchema = z.object({
  message: z.string().min(1),
  stack: z.string().optional(),
  source: z.enum(["SERVER", "CLIENT"]),
  url: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
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
}
