import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

// GET /api/accounts — list connected social accounts for the current user
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accounts = await prisma.socialAccount.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      platform: true,
      username: true,
      expiresAt: true,
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

  // Verify ownership before deleting (prevents IDOR)
  const account = await prisma.socialAccount.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.socialAccount.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
