import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

// GET /api/accounts?businessId=... — list social accounts (optionally scoped to a business)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  const isAdmin = session.user.isAdmin ?? false;

  const memberFilter = isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } };
  const where = businessId
    ? { businessId, ...memberFilter }
    : memberFilter;

  const accounts = await prisma.socialAccount.findMany({
    where,
    select: {
      id: true,
      businessId: true,
      platform: true,
      username: true,
      blotatoAccountId: true,
      createdAt: true,
      // accessToken and refreshToken are intentionally omitted — never exposed to frontend
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(accounts);
}

// DELETE /api/accounts?id=... — disconnect a social account
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Verify access before deleting (prevents IDOR; admins bypass membership check)
  const isAdmin = session.user.isAdmin ?? false;
  const account = await prisma.socialAccount.findFirst({
    where: {
      id,
      ...(isAdmin ? {} : { business: { members: { some: { userId: session.user.id } } } }),
    },
  });

  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.socialAccount.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
