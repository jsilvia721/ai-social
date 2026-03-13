/**
 * Tests for brainstorm markdown rendering and parsing.
 * Covers round-trip, edge cases, and plan link updates.
 */
import type { BrainstormOutput, ParsedBrainstormItem } from "@/lib/brainstorm/types";
import {
  renderBrainstormIssue,
  parseBrainstormIssue,
  updateItemWithPlanLink,
} from "@/lib/brainstorm/markdown";

const sampleOutput: BrainstormOutput = {
  projectSummary: "A social media management platform with AI-powered scheduling.",
  researchInsights: "Recent trends show demand for multi-platform analytics dashboards.",
  items: [
    {
      title: "AI Content Calendar",
      rationale: "Auto-generate weekly content calendars based on strategy.",
      scope: "Large",
      visionAlignment: "Core to the autonomous agent roadmap.",
      category: "Intelligence",
    },
    {
      title: "Analytics Dashboard V2",
      rationale: "Unified cross-platform metrics view.",
      scope: "Medium",
      visionAlignment: "Supports data-driven decisions.",
      category: "UX",
    },
    {
      title: "Webhook Infrastructure",
      rationale: "Real-time event processing from platforms.",
      scope: "Small",
      visionAlignment: "Foundation for real-time features.",
      category: "Infrastructure",
    },
    {
      title: "Referral System",
      rationale: "Organic growth via user referrals.",
      scope: "Medium",
      visionAlignment: "Drives user acquisition.",
      category: "Growth",
    },
    {
      title: "Error Monitoring: Alerts",
      rationale: "Proactive alerting on pipeline failures.",
      scope: "Small",
      visionAlignment: "Operational reliability.",
      category: "Operations",
    },
  ],
};

describe("renderBrainstormIssue", () => {
  it("includes heading and blockquote", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("# 🧠 Brainstorm");
    expect(md).toContain("> ");
  });

  it("includes project snapshot section", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("## 📊 Project Snapshot");
    expect(md).toContain(sampleOutput.projectSummary);
  });

  it("includes research insights section", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("## 🔬 Research Insights");
    expect(md).toContain(sampleOutput.researchInsights);
  });

  it("renders items as checkbox list with bold numbered titles", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("- [ ] **1. AI Content Calendar**");
    expect(md).toContain("- [ ] **2. Analytics Dashboard V2**");
    expect(md).toContain("- [ ] **5. Error Monitoring: Alerts**");
  });

  it("renders indented details for each item", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("  **Rationale:**");
    expect(md).toContain("  **Scope:** Large");
    expect(md).toContain("  **Category:** Intelligence");
    expect(md).toContain("  **Vision Alignment:**");
  });

  it("includes footer with instructions", () => {
    const md = renderBrainstormIssue(sampleOutput);
    expect(md).toContain("## 📋 Instructions");
  });

  it("includes brainstorm-meta HTML comment", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const metaMatch = md.match(/<!-- brainstorm-meta: ({.*}) -->/);
    expect(metaMatch).not.toBeNull();
    const meta = JSON.parse(metaMatch![1]);
    expect(meta.version).toBe(1);
    expect(meta.generatedAt).toBeDefined();
  });
});

describe("parseBrainstormIssue", () => {
  it("parses all items from rendered output", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const items = parseBrainstormIssue(md);
    expect(items).toHaveLength(5);
  });

  it("extracts correct titles and indices", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const items = parseBrainstormIssue(md);
    expect(items[0]).toMatchObject({ index: 1, title: "AI Content Calendar" });
    expect(items[1]).toMatchObject({ index: 2, title: "Analytics Dashboard V2" });
    expect(items[4]).toMatchObject({ index: 5, title: "Error Monitoring: Alerts" });
  });

  it("detects unchecked items", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const items = parseBrainstormIssue(md);
    expect(items.every((i) => !i.checked)).toBe(true);
    expect(items.every((i) => !i.hasPlanLink)).toBe(true);
  });

  it("detects checked items", () => {
    const md = renderBrainstormIssue(sampleOutput)
      .replace("- [ ] **1.", "- [x] **1.");
    const items = parseBrainstormIssue(md);
    expect(items[0].checked).toBe(true);
    expect(items[1].checked).toBe(false);
  });

  it("handles items with colons in titles", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const items = parseBrainstormIssue(md);
    const alertItem = items.find((i) => i.title === "Error Monitoring: Alerts");
    expect(alertItem).toBeDefined();
    expect(alertItem!.index).toBe(5);
  });

  it("detects plan links", () => {
    let md = renderBrainstormIssue(sampleOutput);
    md = md.replace(
      "- [ ] **1. AI Content Calendar**",
      "- [x] **1. AI Content Calendar** → [Plan #42](https://github.com/test/issues/42)"
    );
    const items = parseBrainstormIssue(md);
    expect(items[0].hasPlanLink).toBe(true);
    expect(items[0].planIssueNumber).toBe(42);
    expect(items[0].checked).toBe(true);
  });

  it("returns empty array for empty input", () => {
    expect(parseBrainstormIssue("")).toEqual([]);
  });

  it("returns empty array for markdown with no items", () => {
    expect(parseBrainstormIssue("# Just a heading\n\nSome text")).toEqual([]);
  });
});

describe("updateItemWithPlanLink", () => {
  it("appends plan link to the matching item", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const updated = updateItemWithPlanLink(
      md,
      "AI Content Calendar",
      42,
      "https://github.com/test/issues/42"
    );
    expect(updated).toContain(
      "- [ ] **1. AI Content Calendar** → [Plan #42](https://github.com/test/issues/42)"
    );
  });

  it("does not modify other items", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const updated = updateItemWithPlanLink(
      md,
      "AI Content Calendar",
      42,
      "https://github.com/test/issues/42"
    );
    expect(updated).toContain("- [ ] **2. Analytics Dashboard V2**");
    // Should not have a plan link on item 2
    expect(updated).not.toMatch(/\*\*2\. Analytics Dashboard V2\*\*.*→/);
  });

  it("handles titles with colons", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const updated = updateItemWithPlanLink(
      md,
      "Error Monitoring: Alerts",
      99,
      "https://github.com/test/issues/99"
    );
    expect(updated).toContain(
      "→ [Plan #99](https://github.com/test/issues/99)"
    );
  });

  it("is idempotent — does not duplicate plan link on second call", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const first = updateItemWithPlanLink(
      md,
      "AI Content Calendar",
      42,
      "https://github.com/test/issues/42"
    );
    const second = updateItemWithPlanLink(
      first,
      "AI Content Calendar",
      42,
      "https://github.com/test/issues/42"
    );
    expect(second).toBe(first);
    // Count occurrences of the plan link — should be exactly 1
    const matches = second.match(/→ \[Plan #42\]/g);
    expect(matches).toHaveLength(1);
  });

  it("returns original markdown when title not found", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const updated = updateItemWithPlanLink(
      md,
      "Nonexistent Item",
      42,
      "https://github.com/test/issues/42"
    );
    expect(updated).toBe(md);
  });
});

describe("round-trip: render → parse → verify", () => {
  it("preserves all items through render → parse cycle", () => {
    const md = renderBrainstormIssue(sampleOutput);
    const parsed = parseBrainstormIssue(md);

    expect(parsed).toHaveLength(sampleOutput.items.length);
    sampleOutput.items.forEach((item, i) => {
      expect(parsed[i].title).toBe(item.title);
      expect(parsed[i].index).toBe(i + 1);
      expect(parsed[i].checked).toBe(false);
      expect(parsed[i].hasPlanLink).toBe(false);
    });
  });

  it("preserves structure after adding plan links", () => {
    let md = renderBrainstormIssue(sampleOutput);
    md = updateItemWithPlanLink(md, "AI Content Calendar", 42, "https://github.com/test/42");
    md = updateItemWithPlanLink(md, "Referral System", 55, "https://github.com/test/55");

    const parsed = parseBrainstormIssue(md);
    expect(parsed).toHaveLength(5);

    const item1 = parsed.find((i) => i.title === "AI Content Calendar")!;
    expect(item1.hasPlanLink).toBe(true);
    expect(item1.planIssueNumber).toBe(42);

    const item4 = parsed.find((i) => i.title === "Referral System")!;
    expect(item4.hasPlanLink).toBe(true);
    expect(item4.planIssueNumber).toBe(55);

    // Others should not have plan links
    const item2 = parsed.find((i) => i.title === "Analytics Dashboard V2")!;
    expect(item2.hasPlanLink).toBe(false);
  });
});
