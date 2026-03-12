#!/usr/bin/env npx tsx
/**
 * One-time migration script to recalculate ErrorReport fingerprints
 * using normalizeMessage() and merge duplicate rows.
 *
 * Usage:
 *   npx tsx scripts/backfill-fingerprints.ts            # execute migration
 *   npx tsx scripts/backfill-fingerprints.ts --dry-run   # preview changes
 */

import { prisma } from "../src/lib/db";
import {
  buildMergeGroups,
  type ErrorReportRow,
} from "../src/lib/backfill-fingerprints";

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(
    dryRun
      ? "🔍 DRY RUN — no changes will be made\n"
      : "🚀 Running fingerprint backfill migration\n"
  );

  // Fetch all ErrorReport rows
  const rows = await prisma.errorReport.findMany({
    select: {
      id: true,
      fingerprint: true,
      message: true,
      source: true,
      count: true,
      firstSeenAt: true,
      lastSeenAt: true,
      status: true,
      githubIssueNumber: true,
    },
  });

  console.log(`Found ${rows.length} ErrorReport rows\n`);

  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  const groups = buildMergeGroups(rows as ErrorReportRow[]);

  // Count stats
  let updatedCount = 0;
  let mergedCount = 0;
  let deletedCount = 0;

  // Log what will happen
  for (const group of groups.values()) {
    const fpChanged = group.survivor.fingerprint !== group.newFingerprint;
    const hasDuplicates = group.duplicates.length > 0;

    if (fpChanged || hasDuplicates) {
      updatedCount++;
    }

    if (hasDuplicates) {
      mergedCount++;
      deletedCount += group.duplicates.length;
      console.log(
        `MERGE: ${group.duplicates.length + 1} rows → 1 (fingerprint: ${group.newFingerprint.slice(0, 12)}…)`
      );
      console.log(
        `  Survivor: id=${group.survivor.id} count=${group.survivor.count}`
      );
      console.log(
        `  Merged count: ${group.mergedCount}, firstSeenAt: ${group.mergedFirstSeenAt.toISOString()}, lastSeenAt: ${group.mergedLastSeenAt.toISOString()}`
      );
      if (group.mergedGithubIssueNumber) {
        console.log(
          `  GitHub issue: #${group.mergedGithubIssueNumber}`
        );
      }
      for (const dup of group.duplicates) {
        console.log(`  Delete: id=${dup.id} count=${dup.count}`);
      }
      console.log();
    }
  }

  console.log("--- Summary ---");
  console.log(`Total rows: ${rows.length}`);
  console.log(`Rows to update: ${updatedCount}`);
  console.log(`Groups with merges: ${mergedCount}`);
  console.log(`Rows to delete: ${deletedCount}`);
  console.log(`Rows after migration: ${rows.length - deletedCount}`);

  if (dryRun) {
    console.log("\n🔍 DRY RUN complete — no changes made.");
    return;
  }

  if (updatedCount === 0 && deletedCount === 0) {
    console.log("\nAll fingerprints already up to date.");
    return;
  }

  // Execute migration in a transaction
  console.log("\nExecuting migration…");

  await prisma.$transaction(async (tx) => {
    // Filter to groups that actually need changes
    const changedGroups = [...groups.values()].filter(
      (g) =>
        g.survivor.fingerprint !== g.newFingerprint ||
        g.duplicates.length > 0
    );

    // Step 1: Set fingerprints to temporary values to avoid unique constraint
    // violations during the migration. Use "temp:" prefix + old id.
    for (const group of changedGroups) {
      await tx.errorReport.update({
        where: { id: group.survivor.id },
        data: { fingerprint: `temp:${group.survivor.id}` },
      });
    }

    // Step 2: Delete duplicates and update survivors
    for (const group of changedGroups) {
      // Delete duplicates
      if (group.duplicates.length > 0) {
        await tx.errorReport.deleteMany({
          where: { id: { in: group.duplicates.map((d) => d.id) } },
        });
      }

      // Update survivor with merged data and new fingerprint
      await tx.errorReport.update({
        where: { id: group.survivor.id },
        data: {
          fingerprint: group.newFingerprint,
          count: group.mergedCount,
          firstSeenAt: group.mergedFirstSeenAt,
          lastSeenAt: group.mergedLastSeenAt,
          status: group.mergedStatus,
          githubIssueNumber: group.mergedGithubIssueNumber,
        },
      });
    }
  });

  console.log("\n✅ Migration complete!");
  console.log(`   Updated: ${updatedCount} rows`);
  console.log(`   Deleted: ${deletedCount} duplicate rows`);
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
