/**
 * Brainstorm issue markdown rendering and parsing.
 *
 * Renders BrainstormOutput into a GitHub issue body with checkboxes,
 * and parses issue bodies back into structured data.
 */
import type { BrainstormOutput, ParsedBrainstormItem } from "./types";

/**
 * Render a brainstorm output as a GitHub issue body with checkboxes.
 */
export function renderBrainstormIssue(output: BrainstormOutput): string {
  const lines: string[] = [];

  lines.push("# 🧠 Brainstorm");
  lines.push("");
  lines.push("> AI-generated roadmap ideas based on project context and research.");
  lines.push("");

  // Project snapshot
  lines.push("## 📊 Project Snapshot");
  lines.push("");
  lines.push(output.projectSummary);
  lines.push("");

  // Research insights
  lines.push("## 🔬 Research Insights");
  lines.push("");
  lines.push(output.researchInsights);
  lines.push("");

  // Ideas
  lines.push("## 💡 Ideas");
  lines.push("");
  output.items.forEach((item, i) => {
    lines.push(`- [ ] **${i + 1}. ${item.title}**`);
    lines.push(`  **Rationale:** ${item.rationale}`);
    lines.push(`  **Scope:** ${item.scope}`);
    lines.push(`  **Category:** ${item.category}`);
    lines.push(`  **Vision Alignment:** ${item.visionAlignment}`);
    lines.push("");
  });

  // Footer
  lines.push("## 📋 Instructions");
  lines.push("");
  lines.push("Check an item to approve it for planning. The brainstorm agent will");
  lines.push("automatically create a plan issue and link it back here.");
  lines.push("");

  // Meta comment
  const meta = JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
  });
  lines.push(`<!-- brainstorm-meta: ${meta} -->`);

  return lines.join("\n");
}

/**
 * Parse brainstorm items from a rendered issue body.
 * Handles: bold titles, checked/unchecked, plan links, colons in titles.
 */
export function parseBrainstormIssue(markdown: string): ParsedBrainstormItem[] {
  const items: ParsedBrainstormItem[] = [];

  // Match lines like: - [ ] **1. Title** or - [x] **2. Title** → [Plan #42](url)
  const itemRegex = /^- \[([ x])\] \*\*(\d+)\. (.+?)\*\*(.*)$/gm;

  let match;
  while ((match = itemRegex.exec(markdown)) !== null) {
    const checked = match[1] === "x";
    const index = parseInt(match[2], 10);
    const title = match[3];
    const suffix = match[4];

    // Check for plan link: → [Plan #42](url)
    const planMatch = suffix.match(/→ \[Plan #(\d+)\]/);
    const hasPlanLink = !!planMatch;
    const planIssueNumber = planMatch ? parseInt(planMatch[1], 10) : undefined;

    items.push({ index, title, checked, hasPlanLink, planIssueNumber });
  }

  return items;
}

/**
 * Update a brainstorm issue body to add a plan link to the matching item.
 * Returns the original markdown unchanged if the title is not found.
 */
export function updateItemWithPlanLink(
  markdown: string,
  itemTitle: string,
  planIssueNumber: number,
  planUrl: string,
): string {
  // Only allow GitHub URLs to prevent injection of arbitrary links
  if (!planUrl.startsWith("https://github.com/")) return markdown;

  // Escape special regex chars in the title
  const escapedTitle = itemTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^(- \\[[ x]\\] \\*\\*\\d+\\. ${escapedTitle}\\*\\*)(.*)$`,
    "m"
  );

  const match = markdown.match(pattern);
  if (!match) return markdown;

  // If already has a plan link, don't add another
  if (match[2].includes("→ [Plan #")) return markdown;

  const replacement = `${match[1]} → [Plan #${planIssueNumber}](${planUrl})`;
  return markdown.replace(pattern, replacement);
}
