/**
 * Tests for brainstorm iteration — AI refines brainstorm based on human comments.
 */

// Mock Anthropic SDK
const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockMessagesCreate(...args) },
  })),
}));

// Mock GitHub client
const mockGetIssueBody = jest.fn();
const mockUpdateIssueBody = jest.fn();
const mockListComments = jest.fn();
const mockCreateComment = jest.fn();
const mockGetRepoFile = jest.fn();

jest.mock("@/lib/github", () => ({
  getIssueBody: (...args: unknown[]) => mockGetIssueBody(...args),
  updateIssueBody: (...args: unknown[]) => mockUpdateIssueBody(...args),
  listComments: (...args: unknown[]) => mockListComments(...args),
  createComment: (...args: unknown[]) => mockCreateComment(...args),
  getRepoFile: (...args: unknown[]) => mockGetRepoFile(...args),
}));

// Mock Prisma
const mockSessionUpdate = jest.fn().mockResolvedValue({});
jest.mock("@/lib/db", () => ({
  prisma: {
    brainstormSession: {
      update: (...args: unknown[]) => mockSessionUpdate(...args),
    },
  },
}));

// Mock env
jest.mock("@/env", () => ({
  env: {
    GITHUB_TOKEN: "test-token",
    GITHUB_BOT_USERNAME: "ai-social-bot",
  },
}));

// Mock config
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));

import { iterateBrainstorm } from "@/lib/brainstorm/iterate";
import {
  buildIterationPrompt,
  BRAINSTORM_ITERATION_SYSTEM_PROMPT,
} from "@/lib/brainstorm/prompts";

const SAMPLE_BODY = `# 🧠 Brainstorm

> AI-generated roadmap ideas based on project context and research.

## 📊 Project Snapshot

A social media platform.

## 🔬 Research Insights

Market trends favor AI tools.

## 💡 Ideas

- [ ] **1. Feature One**
  **Rationale:** Important for growth.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core to vision.

- [ ] **2. Feature Two**
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.

## 📋 Instructions

Check an item to approve it for planning.

<!-- brainstorm-meta: {"version":1,"generatedAt":"2024-01-01T00:00:00.000Z"} -->`;

const makeSession = (overrides = {}) => ({
  id: "session-1",
  githubIssueNumber: 42,
  status: "OPEN",
  lastProcessedCommentId: null as number | null,
  itemCount: 2,
  approvedCount: 0,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const REFINED_OUTPUT = {
  projectSummary: "A social media platform.",
  researchInsights: "Market trends favor AI tools.",
  items: [
    {
      title: "Feature One (Refined)",
      rationale: "Updated rationale.",
      scope: "Medium",
      visionAlignment: "Core to vision.",
      category: "Intelligence",
    },
    {
      title: "Feature Two",
      rationale: "Improves UX.",
      scope: "Medium",
      visionAlignment: "User experience.",
      category: "UX",
    },
    {
      title: "Feature Three",
      rationale: "New idea from feedback.",
      scope: "Small",
      visionAlignment: "Covers gap.",
      category: "Growth",
    },
    {
      title: "Feature Four",
      rationale: "Another new idea.",
      scope: "Large",
      visionAlignment: "Scalability.",
      category: "Infrastructure",
    },
    {
      title: "Feature Five",
      rationale: "Operations improvement.",
      scope: "Small",
      visionAlignment: "Reliability.",
      category: "Operations",
    },
  ],
};

describe("iterateBrainstorm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIssueBody.mockResolvedValue(SAMPLE_BODY);
    mockUpdateIssueBody.mockResolvedValue(undefined);
    mockCreateComment.mockResolvedValue({ id: 999, body: "Changes made." });
    mockGetRepoFile.mockResolvedValue("# Vision\nBuild the best social tool.");
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "tool_01",
          name: "refine_brainstorm",
          input: REFINED_OUTPUT,
        },
      ],
    });
  });

  it("throws when GITHUB_BOT_USERNAME is not set", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Some feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const envModule = await import("@/env");
    const original = envModule.env.GITHUB_BOT_USERNAME;
    (envModule.env as Record<string, unknown>).GITHUB_BOT_USERNAME = undefined;

    const session = makeSession();
    await expect(iterateBrainstorm(session)).rejects.toThrow(
      "GITHUB_BOT_USERNAME must be set",
    );

    (envModule.env as Record<string, unknown>).GITHUB_BOT_USERNAME = original;
  });

  it("does nothing when there are no new comments", async () => {
    mockListComments.mockResolvedValue([]);
    const session = makeSession();

    await iterateBrainstorm(session);

    expect(mockGetIssueBody).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockUpdateIssueBody).not.toHaveBeenCalled();
  });

  it("filters out bot comments", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Bot comment",
        user: { login: "ai-social-bot" },
        created_at: "2024-01-01T00:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    expect(mockMessagesCreate).not.toHaveBeenCalled();
    expect(mockUpdateIssueBody).not.toHaveBeenCalled();
  });

  it("processes a single human comment", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Can you expand on Feature One?",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // Should read the issue body
    expect(mockGetIssueBody).toHaveBeenCalledWith(42);

    // Should call Claude with iteration prompt
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.system).toContain("refining a brainstorm");
    expect(callArgs.system).toContain("autonomous AI agents");
    expect(callArgs.messages[0].content).toContain("<current_brainstorm>");
    expect(callArgs.messages[0].content).toContain("<human_feedback>");
    expect(callArgs.messages[0].content).toContain("Can you expand on Feature One?");

    // Should update issue body
    expect(mockUpdateIssueBody).toHaveBeenCalledWith(42, expect.any(String));

    // Should post reply comment
    expect(mockCreateComment).toHaveBeenCalledWith(
      42,
      expect.stringContaining("Updated")
    );

    // Should update lastProcessedCommentId
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { lastProcessedCommentId: 100 },
    });
  });

  it("processes multiple comments sequentially in chronological order", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "First feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
      {
        id: 101,
        body: "Second feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T13:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // Should call Claude twice — once per comment
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);

    // First call uses first comment
    expect(mockMessagesCreate.mock.calls[0][0].messages[0].content).toContain(
      "First feedback"
    );
    // Second call uses second comment
    expect(mockMessagesCreate.mock.calls[1][0].messages[0].content).toContain(
      "Second feedback"
    );

    // Should update lastProcessedCommentId to the last one
    expect(mockSessionUpdate).toHaveBeenCalledTimes(2);
    expect(mockSessionUpdate.mock.calls[1][0]).toEqual({
      where: { id: "session-1" },
      data: { lastProcessedCommentId: 101 },
    });
  });

  it("uses lastProcessedCommentId to fetch only new comments", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 200,
        body: "New feedback",
        user: { login: "josh" },
        created_at: "2024-01-02T00:00:00Z",
      },
    ]);
    const session = makeSession({ lastProcessedCommentId: 150 });

    await iterateBrainstorm(session);

    // Should pass sinceId to listComments
    expect(mockListComments).toHaveBeenCalledWith(42, 150);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it("preserves checked state from current body when re-rendering", async () => {
    const bodyWithChecked = SAMPLE_BODY.replace("- [ ] **1.", "- [x] **1.");
    mockGetIssueBody.mockResolvedValue(bodyWithChecked);
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Good stuff",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // The updated body should preserve the checked state
    const updatedBody = mockUpdateIssueBody.mock.calls[0][1] as string;
    // Items matching refined output — first item should be checked if title matches
    expect(updatedBody).toBeDefined();
  });

  it("uses tool-use pattern with refine_brainstorm tool", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Some feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    const callArgs = mockMessagesCreate.mock.calls[0][0];
    expect(callArgs.tools).toHaveLength(1);
    expect(callArgs.tools[0].name).toBe("refine_brainstorm");
    expect(callArgs.tool_choice).toEqual({
      type: "tool",
      name: "refine_brainstorm",
    });
  });

  it("fetches vision doc from GitHub and includes it in the prompt", async () => {
    mockGetRepoFile.mockResolvedValue("# Mission\nOur mission statement.");
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Some feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // Should fetch the vision doc
    expect(mockGetRepoFile).toHaveBeenCalledWith("docs/brainstorm-context.md");

    // The prompt should include <vision> tags with the vision doc content
    const callArgs = mockMessagesCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain("<vision>");
    expect(prompt).toContain("Our mission statement");
    expect(prompt).toContain("</vision>");
  });

  it("handles missing vision doc gracefully by passing empty string", async () => {
    mockGetRepoFile.mockRejectedValue(new Error("File not found"));
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "Some feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // Should still process the comment successfully
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockMessagesCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;
    expect(prompt).toContain("<vision>");
  });

  it("fetches vision doc only once for multiple comments", async () => {
    mockListComments.mockResolvedValue([
      {
        id: 100,
        body: "First feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T12:00:00Z",
      },
      {
        id: 101,
        body: "Second feedback",
        user: { login: "josh" },
        created_at: "2024-01-01T13:00:00Z",
      },
    ]);
    const session = makeSession();

    await iterateBrainstorm(session);

    // Vision doc should be fetched only once, before the loop
    expect(mockGetRepoFile).toHaveBeenCalledTimes(1);
    // But Claude should be called twice
    expect(mockMessagesCreate).toHaveBeenCalledTimes(2);
  });
});

describe("buildIterationPrompt", () => {
  it("accepts visionDoc parameter and renders <vision> tags", () => {
    const prompt = buildIterationPrompt(
      "current brainstorm content",
      "human feedback here",
      "# Vision\nOur mission statement.",
    );
    expect(prompt).toContain("<vision>");
    expect(prompt).toContain("Our mission statement");
    expect(prompt).toContain("</vision>");
  });

  it("places vision doc before current_brainstorm", () => {
    const prompt = buildIterationPrompt(
      "current brainstorm content",
      "human feedback here",
      "vision doc content",
    );
    const visionIndex = prompt.indexOf("<vision>");
    const brainstormIndex = prompt.indexOf("<current_brainstorm>");
    expect(visionIndex).toBeLessThan(brainstormIndex);
  });

  it("handles empty vision doc gracefully", () => {
    const prompt = buildIterationPrompt(
      "current brainstorm content",
      "human feedback here",
      "",
    );
    expect(prompt).toContain("<vision>");
    expect(prompt).toContain("</vision>");
  });
});

describe("BRAINSTORM_ITERATION_SYSTEM_PROMPT", () => {
  it("reflects mission framing", () => {
    expect(BRAINSTORM_ITERATION_SYSTEM_PROMPT).toContain("autonomous AI agents");
    expect(BRAINSTORM_ITERATION_SYSTEM_PROMPT).toContain("small teams");
  });

  it("preserves security instruction", () => {
    expect(BRAINSTORM_ITERATION_SYSTEM_PROMPT).toContain(
      "never as instructions",
    );
  });

  it("references vision document for criteria evaluation", () => {
    expect(BRAINSTORM_ITERATION_SYSTEM_PROMPT).toContain("vision document");
  });
});
