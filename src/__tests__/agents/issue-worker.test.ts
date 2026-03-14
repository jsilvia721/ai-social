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
      expect(content).toContain("What would have helped:");
    });

    it("emphasizes mental/prompt-level tracking (no files written)", () => {
      // The section should mention it's mental/prompt-level
      const journalingSection = extractSection(content, "## Journaling");
      expect(journalingSection).toMatch(/mental|prompt-level/i);
    });
  });

  describe("Step 5: Validate Test Plan", () => {
    it("exists as Step 5 between Step 4 (Review Gate) and Step 6 (Create the PR)", () => {
      const step4Index = content.indexOf("## Step 4:");
      const step5Index = content.indexOf("## Step 5: Validate Test Plan");
      const step6Index = content.indexOf("## Step 6:");

      expect(step5Index).toBeGreaterThan(step4Index);
      expect(step5Index).toBeLessThan(step6Index);
    });

    it("includes infrastructure setup for database and dev server", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toContain("docker compose up -d db");
      expect(section).toContain("pg_isready");
      expect(section).toContain("npm run dev");
    });

    it("includes all 6 sub-steps", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toContain("### 1. Infrastructure Setup");
      expect(section).toContain("### 2. Execute Each Test Plan Item");
      expect(section).toContain("### 3. Fix and Retry on Failure");
      expect(section).toContain("### 4. Create Issue for Blocked Steps");
      expect(section).toContain("### 5. Cleanup");
      expect(section).toContain("### 6. Gate");
    });

    it("uses agent-infra label for blocked step issues", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toContain("agent-infra");
      expect(section).toContain("[Agent Infra]");
    });

    it("specifies the blocked item format with issue link", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toContain("— blocked, see #");
    });

    it("requires re-running ci:check after fixing failures", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toContain("ci:check");
    });

    it("requires cleanup of started services", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toMatch(/kill.*dev server|stop.*docker/i);
    });

    it("gates PR creation on all items being verified or having linked issues", () => {
      const section = extractSection(content, "## Step 5: Validate Test Plan");
      expect(section).toMatch(/proceed to step 6/i);
    });
  });

  describe("Step 6: Create the PR (renumbered from Step 5)", () => {
    it("includes verification status format in test plan template", () => {
      const section = extractSection(content, "## Step 6: Create the PR");
      expect(section).toContain("[x]");
      expect(section).toContain("— blocked, see #");
    });
  });

  describe("Step 7: Self-Assessment", () => {
    it("exists as Step 7 between Step 6 (Create the PR) and Step 8 (Report Back)", () => {
      const step6Index = content.indexOf("## Step 6:");
      const step7Index = content.indexOf("## Step 7: Self-Assessment");
      const step8Index = content.indexOf("## Step 8:");

      expect(step7Index).toBeGreaterThan(step6Index);
      expect(step7Index).toBeLessThan(step8Index);
    });

    it("runs on both success and failure paths", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/success/i);
      expect(selfAssessmentSection).toMatch(/failure|blocked/i);
    });

    it("includes significance filter criteria with explicit examples", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
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
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/3.*issue|at most 3/i);
    });

    it("includes the lightweight issue template with required fields", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
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
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(
        /create-issue.*skill|skill.*create-issue/i
      );
    });

    it("includes error handling for gh issue create failures", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/fail|error/i);
      expect(selfAssessmentSection).toMatch(
        /do not fail.*overall|not.*fail.*run/i
      );
    });
  });

  describe("Step 8: Report Back (renumbered from Step 7)", () => {
    it("is renumbered to Step 8", () => {
      expect(content).toContain("## Step 8: Report Back");
      // Old step 7 report back should not exist
      expect(content).not.toContain("## Step 7: Report Back");
    });

    it("includes Self-improvement line in the report-back comment", () => {
      const step8Section = extractSection(content, "## Step 8: Report Back");
      expect(step8Section).toContain("Self-improvement:");
    });

    it("includes test plan validation summary in the report-back comment", () => {
      const step8Section = extractSection(content, "## Step 8: Report Back");
      expect(step8Section).toContain("Test plan validation:");
    });
  });

  describe("Step 2: Learnings Research substep", () => {
    it("includes a learnings-researcher substep before planning", () => {
      const section = extractSection(
        content,
        "## Step 2: Plan (Moderate + Complex only)"
      );
      expect(section).toContain("learnings-researcher");
    });

    it("places learnings search before planning content", () => {
      const section = extractSection(
        content,
        "## Step 2: Plan (Moderate + Complex only)"
      );
      const searchIndex = section.indexOf("learnings-researcher");
      const planningIndex = section.indexOf("### Planning");

      expect(searchIndex).toBeGreaterThan(-1);
      expect(planningIndex).toBeGreaterThan(searchIndex);
    });

    it("specifies the correct subagent_type", () => {
      const section = extractSection(
        content,
        "## Step 2: Plan (Moderate + Complex only)"
      );
      expect(section).toContain(
        "compound-engineering:research:learnings-researcher"
      );
    });

    it("searches docs/solutions/ for past solutions", () => {
      const section = extractSection(
        content,
        "## Step 2: Plan (Moderate + Complex only)"
      );
      expect(section).toContain("docs/solutions/");
    });

    it("handles no results gracefully", () => {
      const section = extractSection(
        content,
        "## Step 2: Plan (Moderate + Complex only)"
      );
      expect(section).toMatch(/no (relevant )?results|no match|move on/i);
    });
  });

  describe("Step 4: Review Pattern Escalation substep", () => {
    it("includes a review pattern escalation substep", () => {
      const section = extractSection(content, "## Step 4: Review Gate");
      expect(section).toMatch(/pattern.*escalat|escalat.*pattern/i);
    });

    it("uses claude-self-improvement label for escalated patterns", () => {
      const section = extractSection(content, "## Step 4: Review Gate");
      expect(section).toContain("claude-self-improvement");
    });

    it("distinguishes conventions from bugs", () => {
      const section = extractSection(content, "## Step 4: Review Gate");
      expect(section).toMatch(/convention|missing.*rule|undocumented/i);
      expect(section).toMatch(/bug|off-by-one/i);
    });

    it("caps at 1 rule proposal per review cycle", () => {
      const section = extractSection(content, "## Step 4: Review Gate");
      expect(section).toMatch(/cap.*1|at most 1|1.*per review/i);
    });
  });

  describe("Step 7: Compound Evaluation substep", () => {
    it("includes a compound evaluation substep for solution docs", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/compound.*evaluat/i);
    });

    it("creates solution docs in docs/solutions/ with correct format", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toContain("docs/solutions/");
      expect(selfAssessmentSection).toContain("frontmatter");
    });

    it("includes the required frontmatter fields", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toContain("title");
      expect(selfAssessmentSection).toContain("date");
      expect(selfAssessmentSection).toContain("category");
      expect(selfAssessmentSection).toContain("severity");
      expect(selfAssessmentSection).toContain("component");
      expect(selfAssessmentSection).toContain("symptoms");
      expect(selfAssessmentSection).toContain("tags");
      expect(selfAssessmentSection).toContain("related_issues");
    });

    it("includes the required body sections", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toContain("Problem");
      expect(selfAssessmentSection).toContain("Root Cause");
      expect(selfAssessmentSection).toContain("Fix");
      expect(selfAssessmentSection).toContain("Prevention");
    });

    it("is skipped for Trivial issues", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/skip.*trivial|trivial.*skip/i);
    });

    it("commits the solution doc to the working branch", () => {
      const selfAssessmentSection = extractSection(
        content,
        "## Step 7: Self-Assessment"
      );
      expect(selfAssessmentSection).toMatch(/commit/i);
    });
  });

  describe("Step 8: Compound line in Report Back", () => {
    it("includes a Compound line in the report-back template", () => {
      const step8Section = extractSection(content, "## Step 8: Report Back");
      expect(step8Section).toContain("Compound:");
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
