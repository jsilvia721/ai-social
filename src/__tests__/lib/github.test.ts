/**
 * Tests for GitHub client (src/lib/github.ts).
 * Mock Octokit — do NOT use nock.
 */

const mockIssuesCreate = jest.fn();
const mockIssuesUpdate = jest.fn();
const mockIssuesGet = jest.fn();
const mockIssuesListComments = jest.fn();
const mockIssuesCreateComment = jest.fn();
const mockIssuesListForRepo = jest.fn();
const mockReposGetContent = jest.fn();
const mockPullsList = jest.fn();

jest.mock("@octokit/rest", () => ({
  Octokit: jest.fn().mockImplementation(() => ({
    issues: {
      create: mockIssuesCreate,
      update: mockIssuesUpdate,
      get: mockIssuesGet,
      listComments: mockIssuesListComments,
      createComment: mockIssuesCreateComment,
      listForRepo: mockIssuesListForRepo,
    },
    repos: {
      getContent: mockReposGetContent,
    },
    pulls: {
      list: mockPullsList,
    },
  })),
}));

jest.mock("@/env", () => ({
  env: {
    GITHUB_TOKEN: "test-token",
    GITHUB_REPO_OWNER: "test-owner",
    GITHUB_REPO_NAME: "test-repo",
    GITHUB_BOT_USERNAME: "test-bot",
    BRAINSTORM_FREQUENCY_DAYS: 7,
  },
}));

jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));

import {
  createIssue,
  updateIssueBody,
  getIssueBody,
  getIssue,
  closeIssue,
  listComments,
  createComment,
  getRepoFile,
  listIssues,
  listRecentPRs,
} from "@/lib/github";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockedShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

describe("GitHub client", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShouldMock.mockReturnValue(false);

    // Set up default mock responses
    mockIssuesCreate.mockResolvedValue({
      data: { number: 42, title: "Test Issue", html_url: "https://github.com/test/42" },
    });
    mockIssuesUpdate.mockResolvedValue({ data: {} });
    mockIssuesGet.mockResolvedValue({
      data: {
        number: 42,
        title: "Test Issue",
        body: "Test body",
        state: "open",
        labels: [{ name: "brainstorm" }],
        html_url: "https://github.com/test/42",
      },
    });
    mockIssuesListComments.mockResolvedValue({
      data: [
        { id: 1, body: "Comment 1", user: { login: "user1" }, created_at: "2024-01-01T00:00:00Z" },
        { id: 2, body: "Comment 2", user: { login: "user2" }, created_at: "2024-01-02T00:00:00Z" },
      ],
    });
    mockIssuesCreateComment.mockResolvedValue({
      data: { id: 3, body: "New comment" },
    });
    mockIssuesListForRepo.mockResolvedValue({
      data: [
        {
          number: 10,
          title: "Issue 10",
          body: "Body",
          state: "open",
          labels: [{ name: "brainstorm" }],
          html_url: "https://github.com/test/10",
        },
      ],
    });
    mockReposGetContent.mockResolvedValue({
      data: { content: Buffer.from("file content").toString("base64") },
    });
    mockPullsList.mockResolvedValue({
      data: [
        {
          number: 5,
          title: "PR 5",
          merged_at: new Date().toISOString(),
          html_url: "https://github.com/test/pulls/5",
        },
      ],
    });
  });

  describe("createIssue", () => {
    it("calls Octokit issues.create with correct params", async () => {
      const result = await createIssue("Test Title", "Test Body", ["label1"]);
      expect(mockIssuesCreate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        title: "Test Title",
        body: "Test Body",
        labels: ["label1"],
      });
      expect(result).toEqual({
        number: 42,
        title: "Test Issue",
        html_url: "https://github.com/test/42",
      });
    });
  });

  describe("updateIssueBody", () => {
    it("calls Octokit issues.update with correct params", async () => {
      await updateIssueBody(42, "Updated body");
      expect(mockIssuesUpdate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 42,
        body: "Updated body",
      });
    });
  });

  describe("getIssueBody", () => {
    it("returns issue body string", async () => {
      const body = await getIssueBody(42);
      expect(body).toBe("Test body");
    });
  });

  describe("getIssue", () => {
    it("returns issue data", async () => {
      const issue = await getIssue(42);
      expect(issue.number).toBe(42);
      expect(issue.title).toBe("Test Issue");
      expect(issue.body).toBe("Test body");
      expect(issue.state).toBe("open");
    });
  });

  describe("closeIssue", () => {
    it("calls Octokit issues.update with state closed", async () => {
      await closeIssue(42);
      expect(mockIssuesUpdate).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 42,
        state: "closed",
      });
    });
  });

  describe("listComments", () => {
    it("returns comments for an issue", async () => {
      const comments = await listComments(42);
      expect(comments).toHaveLength(2);
      expect(comments[0].body).toBe("Comment 1");
    });

    it("filters comments by sinceId", async () => {
      const comments = await listComments(42, 1);
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(2);
    });
  });

  describe("createComment", () => {
    it("calls Octokit issues.createComment with correct params", async () => {
      const result = await createComment(42, "New comment");
      expect(mockIssuesCreateComment).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 42,
        body: "New comment",
      });
      expect(result).toEqual({ id: 3, body: "New comment" });
    });
  });

  describe("getRepoFile", () => {
    it("returns decoded file content", async () => {
      const content = await getRepoFile("docs/test.md");
      expect(content).toBe("file content");
      expect(mockReposGetContent).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        path: "docs/test.md",
      });
    });
  });

  describe("listIssues", () => {
    it("calls Octokit issues.listForRepo with labels and state", async () => {
      const issues = await listIssues(["brainstorm"], "open");
      expect(mockIssuesListForRepo).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        labels: "brainstorm",
        state: "open",
        per_page: 100,
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].number).toBe(10);
    });
  });

  describe("listRecentPRs", () => {
    it("calls Octokit pulls.list with correct params", async () => {
      const prs = await listRecentPRs(7);
      expect(mockPullsList).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "test-owner",
          repo: "test-repo",
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 100,
        })
      );
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(5);
    });
  });

  describe("mock guard", () => {
    it("returns canned data when shouldMockExternalApis is true", async () => {
      mockedShouldMock.mockReturnValue(true);

      const issue = await createIssue("Test", "Body", ["label"]);
      expect(issue.number).toBeDefined();
      expect(mockIssuesCreate).not.toHaveBeenCalled();
    });

    it("returns mock data for all methods when mocked", async () => {
      mockedShouldMock.mockReturnValue(true);

      const issue = await getIssue(1);
      expect(issue.number).toBe(1);

      const body = await getIssueBody(1);
      expect(typeof body).toBe("string");

      const comments = await listComments(1);
      expect(Array.isArray(comments)).toBe(true);

      const comment = await createComment(1, "test");
      expect(comment.id).toBeDefined();

      const file = await getRepoFile("test.md");
      expect(typeof file).toBe("string");

      const issues = await listIssues(["label"], "open");
      expect(Array.isArray(issues)).toBe(true);

      const prs = await listRecentPRs(7);
      expect(Array.isArray(prs)).toBe(true);

      await expect(updateIssueBody(1, "body")).resolves.toBeUndefined();
      await expect(closeIssue(1)).resolves.toBeUndefined();

      // None of the real Octokit methods should have been called
      expect(mockIssuesCreate).not.toHaveBeenCalled();
      expect(mockIssuesUpdate).not.toHaveBeenCalled();
      expect(mockIssuesGet).not.toHaveBeenCalled();
      expect(mockIssuesListComments).not.toHaveBeenCalled();
      expect(mockIssuesCreateComment).not.toHaveBeenCalled();
      expect(mockIssuesListForRepo).not.toHaveBeenCalled();
      expect(mockReposGetContent).not.toHaveBeenCalled();
      expect(mockPullsList).not.toHaveBeenCalled();
    });
  });
});
