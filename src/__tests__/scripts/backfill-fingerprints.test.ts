import crypto from "crypto";
import { normalizeMessage } from "@/lib/normalize-error";

// We extract the core logic into a testable module.
// The script itself just calls this with the real prisma client.
import {
  computeFingerprint,
  buildMergeGroups,
  type ErrorReportRow,
} from "@/lib/backfill-fingerprints";

function makeRow(
  overrides: Partial<ErrorReportRow> & { message: string; source: string }
): ErrorReportRow {
  return {
    id: crypto.randomUUID(),
    fingerprint: crypto.createHash("sha256").update("old:" + overrides.message).digest("hex"),
    message: overrides.message,
    source: overrides.source,
    count: overrides.count ?? 1,
    firstSeenAt: overrides.firstSeenAt ?? new Date("2026-01-01"),
    lastSeenAt: overrides.lastSeenAt ?? new Date("2026-01-01"),
    status: overrides.status ?? "NEW",
    githubIssueNumber: overrides.githubIssueNumber ?? null,
    ...overrides,
  };
}

describe("computeFingerprint", () => {
  it("computes sha256 of source:normalizedMessage", () => {
    const message = "Failed to load post 550e8400-e29b-41d4-a716-446655440000";
    const source = "SERVER";

    const expected = crypto
      .createHash("sha256")
      .update(source + ":" + normalizeMessage(message))
      .digest("hex");

    expect(computeFingerprint(source, message)).toBe(expected);
  });

  it("produces different fingerprints for different sources", () => {
    const message = "Some error";
    expect(computeFingerprint("SERVER", message)).not.toBe(
      computeFingerprint("CLIENT", message)
    );
  });

  it("produces same fingerprint for messages differing only in dynamic values", () => {
    const msg1 = "Failed to load post 550e8400-e29b-41d4-a716-446655440000";
    const msg2 = "Failed to load post 6ba7b810-9dad-11d1-80b4-00c04fd430c8";

    expect(computeFingerprint("SERVER", msg1)).toBe(
      computeFingerprint("SERVER", msg2)
    );
  });
});

describe("buildMergeGroups", () => {
  it("returns no merges when all fingerprints are already unique", () => {
    const rows = [
      makeRow({ message: "Error A", source: "SERVER" }),
      makeRow({ message: "Error B", source: "SERVER" }),
    ];

    const groups = buildMergeGroups(rows);

    // Each group should have exactly 1 row (no merges needed)
    for (const group of groups.values()) {
      expect(group.duplicates).toHaveLength(0);
    }
  });

  it("groups rows with same normalized fingerprint", () => {
    const rows = [
      makeRow({ message: "Failed to load post 550e8400-e29b-41d4-a716-446655440000", source: "SERVER" }),
      makeRow({ message: "Failed to load post 6ba7b810-9dad-11d1-80b4-00c04fd430c8", source: "SERVER" }),
    ];

    const groups = buildMergeGroups(rows);

    expect(groups.size).toBe(1);
    const group = [...groups.values()][0];
    expect(group.survivor).toBeDefined();
    expect(group.duplicates).toHaveLength(1);
  });

  it("keeps the row with highest count as survivor", () => {
    const rows = [
      makeRow({ message: "Error 123", source: "SERVER", count: 5 }),
      makeRow({ message: "Error 456", source: "SERVER", count: 10 }),
      makeRow({ message: "Error 789", source: "SERVER", count: 3 }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.survivor.count).toBe(10);
    expect(group.duplicates).toHaveLength(2);
  });

  it("sums counts for merged rows", () => {
    const rows = [
      makeRow({ message: "Error 1", source: "SERVER", count: 5 }),
      makeRow({ message: "Error 2", source: "SERVER", count: 10 }),
      makeRow({ message: "Error 3", source: "SERVER", count: 3 }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.mergedCount).toBe(18); // 5 + 10 + 3
  });

  it("uses earliest firstSeenAt", () => {
    const rows = [
      makeRow({
        message: "Error 100", source: "SERVER",
        firstSeenAt: new Date("2026-03-01"),
        count: 1,
      }),
      makeRow({
        message: "Error 200", source: "SERVER",
        firstSeenAt: new Date("2026-01-01"),
        count: 5,
      }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.mergedFirstSeenAt).toEqual(new Date("2026-01-01"));
  });

  it("uses latest lastSeenAt", () => {
    const rows = [
      makeRow({
        message: "Error 100", source: "SERVER",
        lastSeenAt: new Date("2026-03-15"),
        count: 1,
      }),
      makeRow({
        message: "Error 200", source: "SERVER",
        lastSeenAt: new Date("2026-03-01"),
        count: 5,
      }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.mergedLastSeenAt).toEqual(new Date("2026-03-15"));
  });

  it("preserves githubIssueNumber if any row has one", () => {
    const rows = [
      makeRow({ message: "Error 100", source: "SERVER", githubIssueNumber: null, count: 10 }),
      makeRow({ message: "Error 200", source: "SERVER", githubIssueNumber: 42, count: 1 }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.mergedGithubIssueNumber).toBe(42);
  });

  it("preserves ISSUE_CREATED status if any row has it", () => {
    const rows = [
      makeRow({ message: "Error 100", source: "SERVER", status: "NEW", count: 10 }),
      makeRow({ message: "Error 200", source: "SERVER", status: "ISSUE_CREATED", count: 1 }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    expect(group.mergedStatus).toBe("ISSUE_CREATED");
  });

  it("keeps survivor status when no ISSUE_CREATED exists", () => {
    const rows = [
      makeRow({ message: "Error 100", source: "SERVER", status: "NEW", count: 10 }),
      makeRow({ message: "Error 200", source: "SERVER", status: "RESOLVED", count: 1 }),
    ];

    const groups = buildMergeGroups(rows);
    const group = [...groups.values()][0];

    // Survivor has count 10, status NEW
    expect(group.mergedStatus).toBe("NEW");
  });

  it("does not group rows with different sources", () => {
    const rows = [
      makeRow({ message: "Error 123", source: "SERVER" }),
      makeRow({ message: "Error 456", source: "CLIENT" }),
    ];

    const groups = buildMergeGroups(rows);

    expect(groups.size).toBe(2);
    for (const group of groups.values()) {
      expect(group.duplicates).toHaveLength(0);
    }
  });

  it("handles single row (no merging needed)", () => {
    const rows = [makeRow({ message: "Solo error", source: "SERVER" })];

    const groups = buildMergeGroups(rows);

    expect(groups.size).toBe(1);
    const group = [...groups.values()][0];
    expect(group.duplicates).toHaveLength(0);
    expect(group.mergedCount).toBe(1);
  });

  it("handles empty input", () => {
    const groups = buildMergeGroups([]);
    expect(groups.size).toBe(0);
  });
});
