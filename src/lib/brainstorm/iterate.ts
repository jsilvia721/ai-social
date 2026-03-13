/**
 * Brainstorm iteration — AI refines brainstorm based on human comments.
 *
 * Fetches new comments since lastProcessedCommentId, filters out bot comments,
 * and for each human comment: reads the current issue body, calls Claude to
 * refine the brainstorm, updates the issue, and posts a reply.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import * as github from "@/lib/github";
import { prisma } from "@/lib/db";
import { BrainstormOutputSchema } from "./types";
import { renderBrainstormIssue, parseBrainstormIssue } from "./markdown";
import {
  BRAINSTORM_ITERATION_SYSTEM_PROMPT,
  buildIterationPrompt,
} from "./prompts";
import type { BrainstormSession } from "@prisma/client";

const client = new Anthropic();

/**
 * JSON Schema for the refine_brainstorm tool.
 * Must stay in sync with BrainstormOutputSchema in types.ts.
 */
const refineTool: Anthropic.Tool = {
  name: "refine_brainstorm",
  description:
    "Return the updated brainstorm after incorporating human feedback. " +
    "Preserve items that don't need changes, modify or replace items based on feedback.",
  input_schema: {
    type: "object",
    properties: {
      projectSummary: {
        type: "string",
        description: "Updated project summary (keep if unchanged)",
      },
      researchInsights: {
        type: "string",
        description: "Updated research insights (keep if unchanged)",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Concise idea title (3-10 words)" },
            rationale: {
              type: "string",
              description: "Why this matters now (1-2 sentences)",
            },
            scope: {
              type: "string",
              enum: ["Small", "Medium", "Large"],
              description: "Estimated effort",
            },
            visionAlignment: {
              type: "string",
              description: "How this supports the project vision",
            },
            category: {
              type: "string",
              enum: ["Intelligence", "Infrastructure", "UX", "Growth", "Operations"],
              description: "Primary category",
            },
          },
          required: ["title", "rationale", "scope", "visionAlignment", "category"],
        },
        minItems: 5,
        maxItems: 7,
        description: "5-7 actionable roadmap ideas (updated based on feedback)",
      },
    },
    required: ["projectSummary", "researchInsights", "items"],
  },
};

/**
 * Process new human comments on a brainstorm issue and refine via Claude.
 * Each comment is processed sequentially in chronological order.
 */
export async function iterateBrainstorm(session: BrainstormSession): Promise<void> {
  const comments = await github.listComments(
    session.githubIssueNumber,
    session.lastProcessedCommentId ?? undefined,
  );

  // Filter out bot comments to prevent infinite loops
  const botUsername = env.GITHUB_BOT_USERNAME;
  const humanComments = comments.filter(
    (c) => c.user.login !== botUsername,
  );

  if (humanComments.length === 0) return;

  // Process each comment sequentially
  for (const comment of humanComments) {
    // 1. Read current issue body
    const currentBody = await github.getIssueBody(session.githubIssueNumber);

    // Parse current checked state to preserve it
    const currentItems = parseBrainstormIssue(currentBody);

    // 2. Call Claude with iteration prompt
    const prompt = buildIterationPrompt(currentBody, comment.body);

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: BRAINSTORM_ITERATION_SYSTEM_PROMPT,
      tools: [refineTool],
      tool_choice: { type: "tool", name: "refine_brainstorm" },
      messages: [{ role: "user", content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not call refine_brainstorm");
    }

    const output = BrainstormOutputSchema.parse(toolUse.input);

    // 3. Re-render issue body, preserving checked state from current body
    let updatedBody = renderBrainstormIssue(output);

    // Restore checked state: match by title similarity
    for (const prev of currentItems) {
      if (prev.checked) {
        // Find matching item in new output by exact title match
        const matchingNew = output.items.find((item) => item.title === prev.title);
        if (matchingNew) {
          updatedBody = updatedBody.replace(
            `- [ ] **${output.items.indexOf(matchingNew) + 1}. ${matchingNew.title}**`,
            `- [x] **${output.items.indexOf(matchingNew) + 1}. ${matchingNew.title}**`,
          );
        }
      }
    }

    // 4. Update issue body
    await github.updateIssueBody(session.githubIssueNumber, updatedBody);

    // 5. Post reply comment
    await github.createComment(
      session.githubIssueNumber,
      `🔄 **Updated brainstorm** based on your feedback.\n\n> ${comment.body.split("\n")[0]}`,
    );

    // 6. Update lastProcessedCommentId in DB
    await prisma.brainstormSession.update({
      where: { id: session.id },
      data: { lastProcessedCommentId: comment.id },
    });
  }
}
