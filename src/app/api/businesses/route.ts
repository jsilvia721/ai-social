import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const businesses = await prisma.business.findMany({
    where: { members: { some: { userId: session.user.id } } },
    include: { members: { where: { userId: session.user.id }, select: { role: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(businesses);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { name?: string };
  if (!body.name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Verify user exists in DB (guards against stale JWTs after DB resets)
  const userExists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!userExists) {
    return NextResponse.json(
      { error: "Session expired. Please sign out and sign back in." },
      { status: 401 }
    );
  }

  const business = await prisma.business.create({
    data: {
      name: body.name,
      members: {
        create: { userId: session.user.id, role: "OWNER" },
      },
    },
  });

  return NextResponse.json(business, { status: 201 });
}
