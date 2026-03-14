/**
 * GitHub API client singleton.
 *
 * Wraps @octokit/rest with project-aware defaults (owner/repo from env).
 * When shouldMockExternalApis() returns true, all methods return canned data
 * from src/lib/mocks/github.ts without hitting the GitHub API.
 *
 * If GITHUB_TOKEN is not set, read-only methods return safe defaults (empty
 * strings/arrays). Write operations (createIssue, createComment) throw.
 */
import { Octokit } from "@octokit/rest";
import { env } from "@/env";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { trackApiCall } from "@/lib/system-metrics";
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

// ── Error handling ─────────────────────────────────────────────────────────

interface HttpError extends Error {
  status: number;
}

/**
 * Type guard for Octokit HTTP errors (have a numeric `status` property).
 * Used to identify API errors (403, 404, etc.) for logging before
 * re-throwing or degrading gracefully, depending on the caller.
 */
function isHttpError(error: unknown): error is HttpError {
  return (
    error instanceof Error &&
    "status" in error &&
    typeof (error as Record<string, unknown>).status === "number"
  );
}

const PERMISSION_GUIDANCE =
  "GITHUB_TOKEN lacks required permissions — ensure the PAT has 'repo' scope (classic) or 'Issues: Read and write' (fine-grained).";

/**
 * Detects 403 "Resource not accessible" errors and wraps them with
 * actionable guidance. The original error is preserved as `cause`.
 */
function wrapPermissionError(error: unknown): unknown {
  if (
    isHttpError(error) &&
    error.status === 403 &&
    error.message.includes("Resource not accessible")
  ) {
    return new Error(PERMISSION_GUIDANCE, { cause: error });
  }
  return error;
}

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Creates a GitHub issue. Unlike read-only helpers, this throws on failure
 * because the returned issue number is stored in the DB — a silent fallback
 * would corrupt downstream state.
 *
 * @throws {Error} When GitHub token/repo is not configured or the API call fails.
 */
export async function createIssue(
  title: string,
  body: string,
  labels: string[]
): Promise<{ number: number; title: string; html_url: string }> {
  if (shouldMockExternalApis()) return mockCreateIssue(title, body, labels);

  const octokit = getOctokit();
  if (!octokit) {
    throw new Error(
      "GitHub client not configured — GITHUB_TOKEN or repo params missing"
    );
  }

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    const { data } = await octokit.issues.create({
      ...repoParams(),
      title,
      body,
      labels,
    });
    return { number: data.number, title: data.title, html_url: data.html_url };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] createIssue failed: ${error.message}`);
    }
    throw wrapPermissionError(error);
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "createIssue",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function updateIssueBody(
  issueNumber: number,
  body: string
): Promise<void> {
  if (shouldMockExternalApis()) return;

  const octokit = getOctokit();
  if (!octokit) return;

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    await octokit.issues.update({
      ...repoParams(),
      issue_number: issueNumber,
      body,
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] updateIssueBody failed: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "updateIssueBody",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function getIssueBody(issueNumber: number): Promise<string> {
  if (shouldMockExternalApis()) return mockGetIssueBody(issueNumber);

  const octokit = getOctokit();
  if (!octokit) return "";

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    const { data } = await octokit.issues.get({
      ...repoParams(),
      issue_number: issueNumber,
    });
    return data.body ?? "";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] getIssueBody failed: ${error.message}`);
      return "";
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "getIssueBody",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
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

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
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
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] getIssue failed: ${error.message}`);
      return {
        number: issueNumber,
        title: "",
        body: "",
        state: "open",
        labels: [],
        html_url: "",
      };
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "getIssue",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function closeIssue(issueNumber: number): Promise<void> {
  if (shouldMockExternalApis()) return;

  const octokit = getOctokit();
  if (!octokit) return;

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    await octokit.issues.update({
      ...repoParams(),
      issue_number: issueNumber,
      state: "closed",
    });
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] closeIssue failed: ${error.message}`);
      return;
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "closeIssue",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
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

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
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
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] listComments failed: ${error.message}`);
      return [];
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "listComments",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function createComment(
  issueNumber: number,
  body: string
): Promise<{ id: number; body: string }> {
  if (shouldMockExternalApis()) return mockCreateComment(issueNumber, body);

  const octokit = getOctokit();
  if (!octokit) {
    throw new Error(
      "GitHub client not configured — GITHUB_TOKEN or repo params missing"
    );
  }

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    const { data } = await octokit.issues.createComment({
      ...repoParams(),
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, body: data.body ?? "" };
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] createComment failed: ${error.message}`);
    }
    throw wrapPermissionError(error);
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "createComment",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function getRepoFile(path: string): Promise<string> {
  if (shouldMockExternalApis()) return mockGetRepoFile(path);

  const octokit = getOctokit();
  if (!octokit) return "";

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      ...repoParams(),
      path,
    });

    // data is a single file object when path points to a file
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return "";
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] getRepoFile failed: ${error.message}`);
      return "";
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "getRepoFile",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

export async function listIssues(
  labels: string[],
  state: "open" | "closed" | "all"
): Promise<GitHubIssue[]> {
  if (shouldMockExternalApis()) return mockListIssues(labels, state);

  const octokit = getOctokit();
  if (!octokit) return [];

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
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
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] listIssues failed: ${error.message}`);
      return [];
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "listIssues",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}

/** Note: caps at 100 most-recently-updated closed PRs — sufficient for typical repo volume. */
export async function listRecentPRs(days: number): Promise<GitHubPR[]> {
  if (shouldMockExternalApis()) return mockListRecentPRs(days);

  const octokit = getOctokit();
  if (!octokit) return [];

  const startMs = Date.now();
  let errorMessage: string | undefined;
  let httpStatus: number | undefined;
  try {
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
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
    if (isHttpError(error)) {
      httpStatus = error.status;
      console.warn(`[github] listRecentPRs failed: ${error.message}`);
      return [];
    }
    throw error;
  } finally {
    trackApiCall({
      service: "github",
      endpoint: "listRecentPRs",
      statusCode: httpStatus,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}
