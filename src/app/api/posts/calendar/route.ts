import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const startDateParam = searchParams.get("startDate");
  const endDateParam = searchParams.get("endDate");

  let start: Date;
  let end: Date;

  if (startDateParam && endDateParam) {
    start = new Date(startDateParam);
    end = new Date(endDateParam);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid startDate or endDate" }, { status: 400 });
    }
    if (start >= end) {
      return NextResponse.json({ error: "startDate must be before endDate" }, { status: 400 });
    }
  } else {
    const year = parseInt(searchParams.get("year") ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10); // 0-indexed
    if (isNaN(year) || isNaN(month) || month < 0 || month > 11) {
      return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
    }
    start = new Date(Date.UTC(year, month, 1));
    end = new Date(Date.UTC(year, month + 1, 1));
  }

  const posts = await prisma.post.findMany({
    where: {
      business: { members: { some: { userId: session.user.id } } },
      scheduledAt: { gte: start, lt: end },
    },
    include: { socialAccount: { select: { platform: true, username: true } } },
    orderBy: { scheduledAt: "asc" },
  });

  return NextResponse.json(posts);
}
