/**
 * Mock data for GitHub API calls.
 * Returns realistic responses without hitting the GitHub API.
 */
import type { GitHubIssue, GitHubComment, GitHubPR } from "@/lib/github";

let mockIssueCounter = 100;

export function mockCreateIssue(
  title: string,
  _body: string,
  _labels: string[]
): { number: number; title: string; html_url: string } {
  const number = ++mockIssueCounter;
  return {
    number,
    title,
    html_url: `https://github.com/mock-owner/mock-repo/issues/${number}`,
  };
}

export function mockGetIssue(issueNumber: number): GitHubIssue {
  return {
    number: issueNumber,
    title: `Mock Issue #${issueNumber}`,
    body: `This is the body of mock issue #${issueNumber}.`,
    state: "open",
    labels: [{ name: "brainstorm" }],
    html_url: `https://github.com/mock-owner/mock-repo/issues/${issueNumber}`,
  };
}

export function mockGetIssueBody(issueNumber: number): string {
  return `This is the body of mock issue #${issueNumber}.`;
}

export function mockListComments(_issueNumber: number): GitHubComment[] {
  return [
    {
      id: 1,
      body: "Mock comment 1",
      user: { login: "mock-user" },
      created_at: "2024-01-01T00:00:00Z",
    },
    {
      id: 2,
      body: "Mock comment 2",
      user: { login: "mock-bot" },
      created_at: "2024-01-02T00:00:00Z",
    },
  ];
}

export function mockCreateComment(
  _issueNumber: number,
  body: string
): { id: number; body: string } {
  return { id: Date.now(), body };
}

export function mockGetRepoFile(_path: string): string {
  return "# Mock File Content\n\nThis is mock file content.";
}

export function mockListIssues(
  _labels: string[],
  _state: string
): GitHubIssue[] {
  return [
    {
      number: 1,
      title: "Mock Issue #1",
      body: "Body of mock issue 1",
      state: "open",
      labels: [{ name: "brainstorm" }],
      html_url: "https://github.com/mock-owner/mock-repo/issues/1",
    },
  ];
}

export function mockListRecentPRs(_days: number): GitHubPR[] {
  return [
    {
      number: 10,
      title: "Mock PR #10",
      merged_at: "2024-01-01T00:00:00Z",
      html_url: "https://github.com/mock-owner/mock-repo/pull/10",
    },
  ];
}
