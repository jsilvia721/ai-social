// Test-only endpoint: returns dynamic route parameter IDs for QA audit.
// Returns 404 in all non-test environments — never reachable in production.
import { prisma } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  if (!process.env.PLAYWRIGHT_E2E) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Most recent business
  const business = await prisma.business.findFirst({
    orderBy: { createdAt: "desc" },
  });

  // Most recent post
  const post = await prisma.post.findFirst({
    orderBy: { createdAt: "desc" },
  });

  // If the most recent post doesn't have a repurposeGroupId, find one that does
  let repurposeGroupId = post?.repurposeGroupId ?? null;
  if (!repurposeGroupId) {
    const repurposePost = await prisma.post.findFirst({
      where: { repurposeGroupId: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    repurposeGroupId = repurposePost?.repurposeGroupId ?? null;
  }

  return NextResponse.json({
    businessId: business?.id ?? null,
    postId: post?.id ?? null,
    repurposeGroupId,
  });
}
