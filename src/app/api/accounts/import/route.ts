import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAccounts } from "@/lib/blotato/accounts";
import { toPrismaPlatform } from "@/lib/blotato/types";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";

// POST /api/accounts/import — bulk-import selected Blotato accounts
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { accountIds } = body;

  if (!Array.isArray(accountIds) || accountIds.length === 0) {
    return NextResponse.json(
      { error: "accountIds must be a non-empty array" },
      { status: 400 },
    );
  }

  if (accountIds.length > 20) {
    return NextResponse.json(
      { error: "Maximum 20 accounts per import" },
      { status: 400 },
    );
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
    // Re-validate against Blotato API (prevents tampered requests)
    const blotatoAccounts = await listAccounts();
    const blotatoMap = new Map(blotatoAccounts.map((a) => [a.id, a]));

    // Validate all submitted IDs exist and map to supported platforms
    const invalidIds = accountIds.filter((id: string) => {
      const account = blotatoMap.get(id);
      return !account || toPrismaPlatform(account.platform) === null;
    });

    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid account IDs: ${invalidIds.join(", ")}` },
        { status: 400 },
      );
    }

    // All-or-nothing import via transaction
    const imported = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const accountId of accountIds) {
        const blotatoAccount = blotatoMap.get(accountId)!;
        const platform = toPrismaPlatform(blotatoAccount.platform)!;

        const account = await tx.socialAccount.upsert({
          where: { blotatoAccountId: accountId },
          create: {
            blotatoAccountId: accountId,
            platform,
            platformId: accountId, // Use Blotato ID as platformId
            username: blotatoAccount.username,
            businessId: activeBusinessId,
          },
          update: {
            username: blotatoAccount.username,
            platform,
          },
        });
        results.push(account);
      }
      return results;
    });

    return NextResponse.json(
      {
        imported: imported.map((a) => ({
          id: a.id,
          platform: a.platform,
          username: a.username,
          blotatoAccountId: a.blotatoAccountId,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to import from Blotato: ${message}` },
      { status: 500 },
    );
  }
}
