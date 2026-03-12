import crypto from "crypto";
import { normalizeMessage } from "@/lib/normalize-error";

export type ErrorReportSource = "SERVER" | "CLIENT";
export type ErrorReportStatus = "NEW" | "ISSUE_CREATED" | "RESOLVED" | "IGNORED";

export interface ErrorReportRow {
  id: string;
  fingerprint: string;
  message: string;
  source: ErrorReportSource;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: ErrorReportStatus;
  githubIssueNumber: number | null;
}

export interface MergeGroup {
  newFingerprint: string;
  survivor: ErrorReportRow;
  duplicates: ErrorReportRow[];
  mergedCount: number;
  mergedFirstSeenAt: Date;
  mergedLastSeenAt: Date;
  mergedStatus: ErrorReportStatus;
  mergedGithubIssueNumber: number | null;
}

export function computeFingerprint(source: string, message: string): string {
  return crypto
    .createHash("sha256")
    .update(source + ":" + normalizeMessage(message))
    .digest("hex");
}

export function buildMergeGroups(
  rows: ErrorReportRow[]
): Map<string, MergeGroup> {
  // Group rows by new fingerprint
  const byFingerprint = new Map<string, ErrorReportRow[]>();

  for (const row of rows) {
    const fp = computeFingerprint(row.source, row.message);
    const existing = byFingerprint.get(fp);
    if (existing) {
      existing.push(row);
    } else {
      byFingerprint.set(fp, [row]);
    }
  }

  // Build merge groups
  const groups = new Map<string, MergeGroup>();

  for (const [fp, groupRows] of byFingerprint) {
    // Sort by count descending, then earliest firstSeenAt for tie-breaking
    const sorted = [...groupRows].sort(
      (a, b) =>
        b.count - a.count ||
        a.firstSeenAt.getTime() - b.firstSeenAt.getTime()
    );
    const survivor = sorted[0];
    if (!survivor) throw new Error("Invariant: merge group cannot be empty");
    const duplicates = sorted.slice(1);

    const mergedCount = groupRows.reduce((sum, r) => sum + r.count, 0);

    const mergedFirstSeenAt = new Date(
      Math.min(...groupRows.map((r) => r.firstSeenAt.getTime()))
    );

    const mergedLastSeenAt = new Date(
      Math.max(...groupRows.map((r) => r.lastSeenAt.getTime()))
    );

    // Keep ISSUE_CREATED status if any row has it
    const hasIssueCreated = groupRows.some(
      (r) => r.status === "ISSUE_CREATED"
    );
    const mergedStatus = hasIssueCreated ? "ISSUE_CREATED" : survivor.status;

    // Keep githubIssueNumber if any row has one
    const mergedGithubIssueNumber =
      groupRows.find((r) => r.githubIssueNumber !== null)
        ?.githubIssueNumber ?? null;

    groups.set(fp, {
      newFingerprint: fp,
      survivor,
      duplicates,
      mergedCount,
      mergedFirstSeenAt,
      mergedLastSeenAt,
      mergedStatus,
      mergedGithubIssueNumber,
    });
  }

  return groups;
}
