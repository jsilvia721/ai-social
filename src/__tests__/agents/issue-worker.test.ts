import { readFileSync } from "fs";
import { join } from "path";

// Contract tests: the issue-worker prompt structure is load-bearing for agent behavior.
// Specific field names, section ordering, and content are intentionally asserted here
// to prevent accidental regressions when editing the prompt.
describe("issue-worker agent prompt", () => {
  let content: string;

  beforeAll(() => {
    const filePath = join(
      process.cwd(),
      ".claude",
      "agents",
      "issue-worker.md"
    );
    content = readFileSync(filePath, "utf-8");
  });

  describe("Journaling section", () => {
    it("contains a Journaling section between Input and Step 1", () => {
      const inputIndex = content.indexOf("## Input");
      const journalingIndex = content.indexOf("## Journaling");
      const step1Index = content.indexOf("## Step 1:");

      expect(journalingIndex).toBeGreaterThan(inputIndex);
      expect(journalingIndex).toBeLessThan(step1Index);
    });

    it("includes the journal entry format with all signal types", () => {
      expect(content).toContain("JOURNAL ENTRY:");
      expect(content).toContain("Signal type:");
      expect(content).toContain("re-attempt");
      expect(content).toContain("workaround");
      expect(content).toContain("missing-docs");
      expect(content).toContain("discovered-pattern");
      expect(content).toContain("failure");
    });

    it("includes guidance fields for each entry", () => {
      expect(content).toContain("What happened:");
      expect(content).toContain("What I did instead:");
      expect(content).toContain("What would have helped:");
    });

    it("emphasizes mental/prompt-level tracking (no files written)", () => {
      // The section should mention it's mental/prompt-level
      const journalingSection = extractSection(content, "## Journaling");
      expect(journalingSection).toMatch(/mental|prompt-level/i);
    });
  });

  describe("Step 6: Self-Assessment", () => {
    it("exists as Step 6 between Step 5 (Create the PR) and Step 7 (Report Back)", () => {
      const step5Index = content.indexOf("## Step 5:");
      const step6Index = content.indexOf("## Step 6: Self-Assessment");
      const step7Index = content.indexOf("## Step 7:");

      expect(step6Index).toBeGreaterThan(step5Index);
      expect(step6Index).toBeLessThan(step7Index);
    });

    it("runs on both success and failure paths", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/success/i);
      expect(selfAssessmentSection).toMatch(/failure|blocked/i);
    });

    it("includes significance filter criteria with explicit examples", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      // Should have CREATE and SKIP criteria
      expect(selfAssessmentSection).toMatch(/CREATE.*issue/i);
      expect(selfAssessmentSection).toMatch(/SKIP/i);
      // Should have qualifying and non-qualifying examples
      expect(selfAssessmentSection).toContain("✅");
      expect(selfAssessmentSection).toContain("❌");
    });

    it("caps at 3 issues per run", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/3.*issue|at most 3/i);
    });

    it("includes the lightweight issue template with required fields", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      expect(selfAssessmentSection).toContain("claude-self-improvement");
      expect(selfAssessmentSection).toContain("Self-improvement:");
      expect(selfAssessmentSection).toContain("Signal type:");
      expect(selfAssessmentSection).toContain("Severity:");
      expect(selfAssessmentSection).toContain("Proposed Change");
      expect(selfAssessmentSection).toContain("Acceptance Criteria");
    });

    it("includes escalation path for complex fixes", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/create-issue.*skill|skill.*create-issue/i);
    });

    it("includes error handling for gh issue create failures", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 6: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/fail|error/i);
      expect(selfAssessmentSection).toMatch(/do not fail.*overall|not.*fail.*run/i);
    });
  });

  describe("Step 7: Report Back (renumbered)", () => {
    it("is renumbered from Step 6 to Step 7", () => {
      expect(content).toContain("## Step 7: Report Back");
      // Old step 6 report back should not exist
      expect(content).not.toContain("## Step 6: Report Back");
    });

    it("includes Self-improvement line in the report-back comment", () => {
      const step7Section = extractSection(content, "## Step 7: Report Back");
      expect(step7Section).toContain("Self-improvement:");
    });
  });

  describe("Rules section", () => {
    it("includes the self-assessment rule", () => {
      const rulesSection = extractSection(content, "## Rules");
      expect(rulesSection).toMatch(/always run self-assessment/i);
      expect(rulesSection).toMatch(/3.*per run|cap.*3/i);
    });
  });
});

/**
 * Extract text from a section heading to the next same-level heading or end of file.
 * Skips headings inside fenced code blocks.
 */
function extractSection(content: string, heading: string): string {
  const startIndex = content.indexOf(heading);
  if (startIndex === -1) {
    throw new Error(`Section "${heading}" not found in content`);
  }

  const headingLevel = heading.match(/^#+/)?.[0].length ?? 2;
  const afterHeading = content.slice(startIndex + heading.length);

  // Walk through lines, tracking code fences
  const lines = afterHeading.split("\n");
  let inCodeBlock = false;
  let endLineIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Check for a same-or-higher-level heading
    const headingMatch = line.match(/^(#{1,6}) /);
    if (headingMatch && headingMatch[1].length <= headingLevel) {
      endLineIndex = i;
      break;
    }
  }

  if (endLineIndex >= 0) {
    return lines.slice(0, endLineIndex).join("\n");
  }
  return afterHeading;
}
