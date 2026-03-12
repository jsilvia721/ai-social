import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAccounts } from "@/lib/blotato/accounts";
import { toPrismaPlatform } from "@/lib/blotato/types";
import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";

// GET /api/accounts/available — fetch Blotato accounts not yet imported
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { activeBusinessId, isAdmin } = session.user;
  if (!activeBusinessId) {
    return NextResponse.json(
      { error: "No active business selected" },
      { status: 400 },
    );
  }

  // Membership check (admin bypass)
  if (!isAdmin) {
    const business = await prisma.business.findFirst({
      where: { id: activeBusinessId, members: { some: { userId: session.user.id } } },
    });
    if (!business) {
      return NextResponse.json(
        { error: "Not a member of this business" },
        { status: 403 },
      );
    }
  }

  try {
    const [blotatoAccounts, existingAccounts] = await Promise.all([
      listAccounts(),
      // Global check — prevents cross-business claiming conflicts
      prisma.socialAccount.findMany({
        where: { blotatoAccountId: { not: "" } },
        select: { blotatoAccountId: true },
      }),
    ]);

    const importedIds = new Set(existingAccounts.map((a) => a.blotatoAccountId));

    const available = blotatoAccounts
      .filter((a) => {
        const prismaPlatform = toPrismaPlatform(a.platform);
        return prismaPlatform !== null && !importedIds.has(a.id);
      })
      .map((a) => ({
        id: a.id,
        platform: toPrismaPlatform(a.platform)!,
        username: a.username,
        fullname: a.fullname,
      }));

    return NextResponse.json({ accounts: available });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch from Blotato: ${message}` },
      { status: 500 },
    );
  }
}
