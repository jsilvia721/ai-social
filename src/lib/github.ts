/**
 * GitHub API client singleton.
 *
 * Wraps @octokit/rest with project-aware defaults (owner/repo from env).
 * When shouldMockExternalApis() returns true, all methods return canned data
 * from src/lib/mocks/github.ts without hitting the GitHub API.
 *
 * If GITHUB_TOKEN is not set, all methods are no-ops (return safe defaults).
 */
import { Octokit } from "@octokit/rest";
import { env } from "@/env";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  mockCreateIssue,
  mockGetIssue,
  mockGetIssueBody,
  mockListComments,
  mockCreateComment,
  mockGetRepoFile,
  mockListIssues,
  mockListRecentPRs,
} from "@/lib/mocks/github";

// ── Canonical return types ──────────────────────────────────────────────────

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: { name: string }[];
  html_url: string;
}

export interface GitHubComment {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  merged_at: string | null;
  html_url: string;
}

// ── Internals ───────────────────────────────────────────────────────────────

// Lazy-init singleton — only created when token is available
let _octokit: Octokit | null = null;

function getOctokit(): Octokit | null {
  if (!env.GITHUB_TOKEN) return null;
  if (!env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) return null;
  if (!_octokit) {
    _octokit = new Octokit({ auth: env.GITHUB_TOKEN });
  }
  return _octokit;
}

function repoParams() {
  return {
    owner: env.GITHUB_REPO_OWNER ?? "",
    repo: env.GITHUB_REPO_NAME ?? "",
  };
}

/**
 * Run a GitHub API call with graceful 403 handling.
 * When the token lacks required scopes, logs a warning and returns the fallback
 * instead of throwing. Non-403 errors are re-thrown.
 */
async function withPermissionFallback<T>(
  operation: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof Error &&
      "status" in error &&
      (error as Record<string, unknown>).status === 403
    ) {
      console.warn(
        `GitHub API permission error in ${operation}: ${error.message}. ` +
          `Ensure GITHUB_TOKEN has the required scopes (e.g., "issues:write" or "repo").`,
      );
      return fallback;
    }
    throw error;
  }
}

// ── Public helpers ──────────────────────────────────────────────────────────

export async function createIssue(
  title: string,
  body: string,
  labels: string[]
): Promise<{ number: number; title: string; html_url: string }> {
  if (shouldMockExternalApis()) return mockCreateIssue(title, body, labels);

  const octokit = getOctokit();
  if (!octokit) return { number: 0, title, html_url: "" };

  return withPermissionFallback("createIssue", { number: 0, title, html_url: "" }, async () => {
    const { data } = await octokit.issues.create({
      ...repoParams(),
      title,
      body,
      labels,
    });
    return { number: data.number, title: data.title, html_url: data.html_url };
  });
}

export async function updateIssueBody(
  issueNumber: number,
  body: string
): Promise<void> {
  if (shouldMockExternalApis()) return;

  const octokit = getOctokit();
  if (!octokit) return;

  await withPermissionFallback("updateIssueBody", undefined, async () => {
    await octokit.issues.update({
      ...repoParams(),
      issue_number: issueNumber,
      body,
    });
  });
}

export async function getIssueBody(issueNumber: number): Promise<string> {
  if (shouldMockExternalApis()) return mockGetIssueBody(issueNumber);

  const octokit = getOctokit();
  if (!octokit) return "";

  const { data } = await octokit.issues.get({
    ...repoParams(),
    issue_number: issueNumber,
  });
  return data.body ?? "";
}

export async function getIssue(issueNumber: number): Promise<GitHubIssue> {
  if (shouldMockExternalApis()) return mockGetIssue(issueNumber);

  const octokit = getOctokit();
  if (!octokit)
    return {
      number: issueNumber,
      title: "",
      body: "",
      state: "open",
      labels: [],
      html_url: "",
    };

  const { data } = await octokit.issues.get({
    ...repoParams(),
    issue_number: issueNumber,
  });
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    state: data.state,
    labels: (data.labels ?? []).map((l) =>
      typeof l === "string" ? { name: l } : { name: l.name ?? "" }
    ),
    html_url: data.html_url,
  };
}

export async function closeIssue(issueNumber: number): Promise<void> {
  if (shouldMockExternalApis()) return;

  const octokit = getOctokit();
  if (!octokit) return;

  await withPermissionFallback("closeIssue", undefined, async () => {
    await octokit.issues.update({
      ...repoParams(),
      issue_number: issueNumber,
      state: "closed",
    });
  });
}

export async function listComments(
  issueNumber: number,
  sinceId?: number
): Promise<GitHubComment[]> {
  if (shouldMockExternalApis()) {
    const comments = mockListComments(issueNumber);
    if (sinceId) return comments.filter((c) => c.id > sinceId);
    return comments;
  }

  const octokit = getOctokit();
  if (!octokit) return [];

  const { data } = await octokit.issues.listComments({
    ...repoParams(),
    issue_number: issueNumber,
    per_page: 100,
  });

  const comments: GitHubComment[] = data.map((c) => ({
    id: c.id,
    body: c.body ?? "",
    user: { login: c.user?.login ?? "" },
    created_at: c.created_at,
  }));

  if (sinceId) return comments.filter((c) => c.id > sinceId);
  return comments;
}

export async function createComment(
  issueNumber: number,
  body: string
): Promise<{ id: number; body: string }> {
  if (shouldMockExternalApis()) return mockCreateComment(issueNumber, body);

  const octokit = getOctokit();
  if (!octokit) return { id: 0, body };

  return withPermissionFallback("createComment", { id: 0, body }, async () => {
    const { data } = await octokit.issues.createComment({
      ...repoParams(),
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, body: data.body ?? "" };
  });
}

export async function getRepoFile(path: string): Promise<string> {
  if (shouldMockExternalApis()) return mockGetRepoFile(path);

  const octokit = getOctokit();
  if (!octokit) return "";

  const { data } = await octokit.repos.getContent({
    ...repoParams(),
    path,
  });

  // data is a single file object when path points to a file
  if ("content" in data && typeof data.content === "string") {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return "";
}

export async function listIssues(
  labels: string[],
  state: "open" | "closed" | "all"
): Promise<GitHubIssue[]> {
  if (shouldMockExternalApis()) return mockListIssues(labels, state);

  const octokit = getOctokit();
  if (!octokit) return [];

  const { data } = await octokit.issues.listForRepo({
    ...repoParams(),
    labels: labels.join(","),
    state,
    per_page: 100,
  });

  return data.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state,
    labels: (issue.labels ?? []).map((l) =>
      typeof l === "string" ? { name: l } : { name: l.name ?? "" }
    ),
    html_url: issue.html_url,
  }));
}

/** Note: caps at 100 most-recently-updated closed PRs — sufficient for typical repo volume. */
export async function listRecentPRs(days: number): Promise<GitHubPR[]> {
  if (shouldMockExternalApis()) return mockListRecentPRs(days);

  const octokit = getOctokit();
  if (!octokit) return [];

  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await octokit.pulls.list({
    ...repoParams(),
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 100,
  });

  return data
    .filter((pr) => pr.merged_at && new Date(pr.merged_at) >= since)
    .map((pr) => ({
      number: pr.number,
      title: pr.title,
      merged_at: pr.merged_at,
      html_url: pr.html_url,
    }));
}
