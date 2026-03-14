/**
 * Brainstorm promotion — checked items become Plan issues on GitHub.
 *
 * Reads the brainstorm issue body, finds checked items without plan links,
 * creates plan issues, updates the brainstorm with links, and handles auto-close.
 */
import * as github from "@/lib/github";
import { prisma } from "@/lib/db";
import { parseBrainstormIssue, updateItemWithPlanLink } from "./markdown";
import type { BrainstormSession } from "@prisma/client";
import { reportServerError } from "@/lib/server-error-reporter";

/** 24 hours in milliseconds — comments must be older than this for auto-close. */
const AUTO_CLOSE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Build plan issue body from brainstorm item details parsed from the issue.
 */
function buildPlanBody(
  brainstormIssueNumber: number,
  itemBody: string,
): string {
  return `> From brainstorm #${brainstormIssueNumber}

## Context

${itemBody}

## Scope

_To be defined during planning._

## Acceptance Criteria

- [ ] _TBD_
`;
}

/**
 * Extract the detail block for a specific item from the brainstorm body.
 * Returns rationale, scope, category, and vision alignment as a text block.
 */
function extractItemDetails(
  body: string,
  itemTitle: string,
): string {
  // Find the line with the item title, then grab indented detail lines after it
  const lines = body.split("\n");
  const escapedTitle = itemTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const titlePattern = new RegExp(`^- \\[[ x]\\] \\*\\*\\d+\\. ${escapedTitle}\\*\\*`);

  let capturing = false;
  const details: string[] = [];

  for (const line of lines) {
    if (titlePattern.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      // Detail lines are indented with 2 spaces and start with **Label:**
      if (line.startsWith("  **")) {
        details.push(line.trim());
      } else {
        // Stop capturing at non-detail line (blank or next item)
        if (details.length > 0) break;
      }
    }
  }

  return details.join("\n");
}

/**
 * Promote checked brainstorm items to Plan issues.
 * Also handles auto-close logic and manual close sync.
 */
export async function promoteBrainstormItems(
  session: BrainstormSession,
): Promise<void> {
  if (session.githubIssueNumber <= 0) {
    await reportServerError(
      `Invalid githubIssueNumber (${session.githubIssueNumber}) in promoteBrainstormItems — skipping`,
      { metadata: { sessionId: session.id, githubIssueNumber: session.githubIssueNumber } },
    );
    return;
  }

  // Single API call — getIssue returns both body and state
  const issue = await github.getIssue(session.githubIssueNumber);
  const body = issue.body;

  // Sync manually-closed issues
  if (issue.state === "closed") {
    await prisma.brainstormSession.update({
      where: { id: session.id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    return;
  }

  const items = parseBrainstormIssue(body);

  // Find items that need promotion: checked but no plan link
  const needsPromotion = items.filter((item) => item.checked && !item.hasPlanLink);

  let currentBody = body;
  let promotedCount = 0;

  if (needsPromotion.length > 0) {
    // Fetch existing plan issues for deduplication
    const existingPlans = await github.listIssues(["plan"], "all");
    const existingTitles = new Set(existingPlans.map((i) => i.title));

    for (const item of needsPromotion) {
      const planTitle = `Plan: ${item.title}`;

      // Skip if plan already exists (deduplication)
      if (existingTitles.has(planTitle)) continue;

      // Extract item details from the body
      const details = extractItemDetails(currentBody, item.title);
      const planBody = buildPlanBody(session.githubIssueNumber, details);

      // Create plan issue — continue promoting remaining items if one fails
      let planIssue: { number: number; html_url: string };
      try {
        planIssue = await github.createIssue(planTitle, planBody, ["plan"]);
      } catch (error) {
        console.warn(`[promote] Failed to create plan issue "${planTitle}": ${(error as Error).message}`);
        continue;
      }

      // Skip if createIssue failed (returns number: 0) — don't add to dedup set so it can retry
      if (planIssue.number === 0) {
        console.warn(
          `[promote] Failed to create plan issue for "${item.title}" — skipping, will retry next run`,
        );
        continue;
      }

      // Update brainstorm body with plan link
      currentBody = updateItemWithPlanLink(
        currentBody,
        item.title,
        planIssue.number,
        planIssue.html_url,
      );

      // Track in dedup set
      existingTitles.add(planTitle);
      promotedCount++;
    }

    // Update the issue body with all plan links
    if (currentBody !== body) {
      await github.updateIssueBody(session.githubIssueNumber, currentBody);
    }

    // Batch increment approvedCount
    if (promotedCount > 0) {
      await prisma.brainstormSession.update({
        where: { id: session.id },
        data: { approvedCount: { increment: promotedCount } },
      });
    }
  }

  // Auto-close check: use local currentBody (already updated)
  const updatedItems = parseBrainstormIssue(currentBody);

  // All items resolved = every item is either (checked + linked) or unchecked
  const allResolved = updatedItems.length > 0 && updatedItems.every(
    (item) => (item.checked && item.hasPlanLink) || !item.checked,
  );

  // Only auto-close if all checked items have links (at least one must be checked)
  const hasCheckedItems = updatedItems.some((item) => item.checked);

  if (allResolved && hasCheckedItems) {
    // Check if last comment was >24h ago
    const comments = await github.listComments(session.githubIssueNumber);
    const lastComment = comments[comments.length - 1];

    const lastCommentAge = lastComment
      ? Date.now() - new Date(lastComment.created_at).getTime()
      : Infinity;

    if (lastCommentAge > AUTO_CLOSE_COOLDOWN_MS) {
      await github.closeIssue(session.githubIssueNumber);
      await prisma.brainstormSession.update({
        where: { id: session.id },
        data: { status: "CLOSED", closedAt: new Date() },
      });
    }
  }
}
