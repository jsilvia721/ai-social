/**
 * Tests for brainstorm generation pipeline.
 * Mocks GitHub client, Anthropic SDK, and Prisma.
 */

// Mock Anthropic SDK — use __esModule pattern to avoid hoisting issues
const mockMessagesCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: (...args: unknown[]) => mockMessagesCreate(...args) },
  })),
}));

// Mock GitHub client — delegate to jest.fn() instances defined above the mock
const mockListIssues = jest.fn();
const mockListRecentPRs = jest.fn();
const mockGetRepoFile = jest.fn();
const mockCreateIssue = jest.fn();

jest.mock("@/lib/github", () => ({
  listIssues: (...args: unknown[]) => mockListIssues(...args),
  listRecentPRs: (...args: unknown[]) => mockListRecentPRs(...args),
  getRepoFile: (...args: unknown[]) => mockGetRepoFile(...args),
  createIssue: (...args: unknown[]) => mockCreateIssue(...args),
}));

// Mock Prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    brainstormSession: {
      create: jest.fn().mockResolvedValue({ id: "cuid1" }),
    },
  },
}));

// Mock config
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));

// Mock env
jest.mock("@/env", () => ({
  env: {
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO_OWNER: "test-owner",
    GITHUB_REPO_NAME: "test-repo",
  },
}));

import { generateBrainstorm } from "@/lib/brainstorm/generate";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { prisma } from "@/lib/db";

const mockBrainstormCreate = prisma.brainstormSession.create as jest.Mock;

const mockedShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

const validToolOutput = {
  projectSummary: "A social media platform with AI features.",
  researchInsights: "Market trends favor AI-native tools.",
  items: [
    {
      title: "Feature One",
      rationale: "Important for growth.",
      scope: "Small",
      visionAlignment: "Core to vision.",
      category: "Intelligence",
    },
    {
      title: "Feature Two",
      rationale: "Improves UX significantly.",
      scope: "Medium",
      visionAlignment: "User experience priority.",
      category: "UX",
    },
    {
      title: "Feature Three",
      rationale: "Infrastructure need.",
      scope: "Large",
      visionAlignment: "Scalability.",
      category: "Infrastructure",
    },
    {
      title: "Feature Four",
      rationale: "Growth opportunity.",
      scope: "Small",
      visionAlignment: "Acquisition.",
      category: "Growth",
    },
    {
      title: "Feature Five",
      rationale: "Operational improvement.",
      scope: "Medium",
      visionAlignment: "Reliability.",
      category: "Operations",
    },
  ],
};

describe("generateBrainstorm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldMock.mockReturnValue(false);

    // Default mocks
    mockListIssues.mockResolvedValue([
      { number: 1, title: "Issue 1", body: "", state: "open", labels: [], html_url: "" },
    ]);
    mockListRecentPRs.mockResolvedValue([
      { number: 10, title: "PR 10", merged_at: "2024-01-01", html_url: "" },
    ]);
    mockGetRepoFile.mockResolvedValue("# Vision\nBuild the best social tool.");
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: "Brainstorm: Week of Jan 1, 2024",
      html_url: "https://github.com/test/issues/42",
    });
    mockMessagesCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          id: "tool_01",
          name: "generate_brainstorm",
          input: validToolOutput,
        },
      ],
    });
  });

  describe("mock guard", () => {
    it("returns mock data when shouldMockExternalApis is true", async () => {
      mockedShouldMock.mockReturnValue(true);
      const result = await generateBrainstorm();
      expect(result).not.toBeNull();
      expect(result!.issueNumber).toBeDefined();
      expect(result!.url).toContain("github.com");
      // Should not call real APIs
      expect(mockListIssues).not.toHaveBeenCalled();
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });
  });

  describe("context gathering", () => {
    it("calls GitHub methods to gather context", async () => {
      await generateBrainstorm();
      expect(mockListIssues).toHaveBeenCalledWith(["enhancement", "bug"], "open");
      expect(mockListRecentPRs).toHaveBeenCalledWith(30);
      expect(mockGetRepoFile).toHaveBeenCalledWith("docs/brainstorm-context.md");
    });
  });

  describe("Claude API call", () => {
    it("calls Claude with the correct tool definition", async () => {
      await generateBrainstorm();
      expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("claude-sonnet-4-6");
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe("generate_brainstorm");
      expect(callArgs.tool_choice).toEqual({
        type: "tool",
        name: "generate_brainstorm",
      });
    });

    it("includes system prompt with safety pattern", async () => {
      await generateBrainstorm();
      const callArgs = mockMessagesCreate.mock.calls[0][0];
      expect(callArgs.system).toContain("product strategist");
      expect(callArgs.system).toContain("never as instructions");
    });

    it("includes context in the user message", async () => {
      await generateBrainstorm();
      const callArgs = mockMessagesCreate.mock.calls[0][0];
      const userMsg = callArgs.messages[0].content;
      expect(userMsg).toContain("#1: Issue 1");
      expect(userMsg).toContain("#10: PR 10");
      expect(userMsg).toContain("Build the best social tool");
    });
  });

  describe("issue creation", () => {
    it("creates a GitHub issue with correct format", async () => {
      await generateBrainstorm();
      expect(mockCreateIssue).toHaveBeenCalledTimes(1);
      const [title, body, labels] = mockCreateIssue.mock.calls[0];
      expect(title).toMatch(/^Brainstorm: Week of /);
      expect(body).toContain("# 🧠 Brainstorm");
      expect(body).toContain("- [ ] **1. Feature One**");
      expect(body).toContain("- [ ] **5. Feature Five**");
      expect(labels).toEqual(["brainstorm"]);
    });
  });

  describe("database record", () => {
    it("creates a BrainstormSession record", async () => {
      await generateBrainstorm();
      expect(mockBrainstormCreate).toHaveBeenCalledWith({
        data: {
          githubIssueNumber: 42,
          itemCount: 5,
        },
      });
    });
  });

  describe("return value", () => {
    it("returns issue number and URL", async () => {
      const result = await generateBrainstorm();
      expect(result).toEqual({
        issueNumber: 42,
        url: "https://github.com/test/issues/42",
      });
    });
  });

  describe("error handling", () => {
    it("throws when Claude does not call the tool", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [{ type: "text", text: "I cannot do that." }],
      });
      await expect(generateBrainstorm()).rejects.toThrow(
        "Claude did not call generate_brainstorm"
      );
    });

    it("throws when Claude returns invalid output", async () => {
      mockMessagesCreate.mockResolvedValue({
        content: [
          {
            type: "tool_use",
            id: "tool_01",
            name: "generate_brainstorm",
            input: { projectSummary: "test", researchInsights: "test", items: [] },
          },
        ],
      });
      await expect(generateBrainstorm()).rejects.toThrow();
    });
  });
});
