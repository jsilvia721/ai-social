/**
 * Brainstorm generation pipeline.
 *
 * Gathers project context from GitHub, synthesizes roadmap ideas via Claude,
 * renders a markdown issue, creates it on GitHub, and stores a DB record.
 */
import Anthropic from "@anthropic-ai/sdk";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { mockGenerateBrainstorm } from "@/lib/mocks/brainstorm";
import { BrainstormOutputSchema } from "./types";
import { BRAINSTORM_SYSTEM_PROMPT, buildGenerationPrompt } from "./prompts";
import { renderBrainstormIssue } from "./markdown";
import * as github from "@/lib/github";
import { prisma } from "@/lib/db";

const client = new Anthropic();

// NOTE: This JSON Schema must stay in sync with BrainstormOutputSchema in types.ts.
// The Anthropic tool-use API requires raw JSON Schema, so we cannot derive this from Zod.
const brainstormTool: Anthropic.Tool = {
  name: "generate_brainstorm",
  description:
    "Generate a structured brainstorm with 5-7 actionable roadmap ideas " +
    "based on project context and research insights.",
  input_schema: {
    type: "object",
    properties: {
      projectSummary: {
        type: "string",
        description: "1-2 sentence summary of the project's current state",
      },
      researchInsights: {
        type: "string",
        description: "Key insights from analyzing open issues, recent PRs, and vision doc",
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
              description: "Estimated effort: Small (1-2d), Medium (3-5d), Large (1-2w)",
            },
            visionAlignment: {
              type: "string",
              description: "How this supports the project vision",
            },
            category: {
              type: "string",
              enum: ["Intelligence", "Infrastructure", "UX", "Growth", "Operations"],
              description: "Primary category for this idea",
            },
          },
          required: ["title", "rationale", "scope", "visionAlignment", "category"],
        },
        minItems: 5,
        maxItems: 7,
        description: "5-7 actionable roadmap ideas spanning multiple categories",
      },
    },
    required: ["projectSummary", "researchInsights", "items"],
  },
};

/**
 * Generate a brainstorm issue: gather context, call Claude, create GitHub issue, save DB record.
 * Throws on failure — callers should handle errors explicitly.
 */
export async function generateBrainstorm(): Promise<{
  issueNumber: number;
  url: string;
}> {
  if (shouldMockExternalApis()) {
    return mockGenerateBrainstorm();
  }

  // 1. Gather context from GitHub
  const [openIssues, recentPRs, visionDoc] = await Promise.all([
    github.listIssues(["enhancement", "bug"], "open"),
    github.listRecentPRs(30),
    github.getRepoFile("docs/brainstorm-context.md"),
  ]);

  // 2. Build prompt and call Claude
  const prompt = buildGenerationPrompt({ openIssues, recentPRs, visionDoc });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: BRAINSTORM_SYSTEM_PROMPT,
    tools: [brainstormTool],
    tool_choice: { type: "tool", name: "generate_brainstorm" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not call generate_brainstorm");
  }

  // 3. Validate output with Zod
  const output = BrainstormOutputSchema.parse(toolUse.input);

  // 4. Render markdown
  const now = new Date();
  const weekLabel = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const body = renderBrainstormIssue(output);

  // 5. Create GitHub issue
  const issue = await github.createIssue(
    `Brainstorm: Week of ${weekLabel}`,
    body,
    ["brainstorm"],
  );

  if (issue.number <= 0) {
    throw new Error(
      `GitHub issue creation returned invalid issue number: ${issue.number}`,
    );
  }

  // 6. Create DB record
  await prisma.brainstormSession.create({
    data: {
      githubIssueNumber: issue.number,
      itemCount: output.items.length,
    },
  });

  return { issueNumber: issue.number, url: issue.html_url };
}
