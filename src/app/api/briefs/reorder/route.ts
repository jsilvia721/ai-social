import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const ReorderSchema = z.object({
  briefIds: z.array(z.string()).min(1).max(100),
});

/** PATCH /api/briefs/reorder — update sortOrder for briefs */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ReorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { briefIds } = parsed.data;

  // Verify all briefs exist and belong to the same business the user is a member of
  const briefs = await prisma.contentBrief.findMany({
    where: { id: { in: briefIds } },
    select: { id: true, businessId: true },
  });

  if (briefs.length !== briefIds.length) {
    return NextResponse.json({ error: "Some briefs not found" }, { status: 404 });
  }

  const businessIds = [...new Set(briefs.map((b) => b.businessId))];
  if (businessIds.length !== 1) {
    return NextResponse.json(
      { error: "All briefs must belong to the same business" },
      { status: 400 }
    );
  }

  const membership = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId: businessIds[0], userId: session.user.id } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this business" }, { status: 403 });
  }

  // Update sortOrder for each brief based on position in array
  await prisma.$transaction(
    briefIds.map((id, index) =>
      prisma.contentBrief.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  return NextResponse.json({ success: true });
}
