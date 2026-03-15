import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/github", () => ({
  createIssue: jest.fn(),
}));
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: jest.fn(),
}));
jest.mock("@/lib/blotato/ssrf-guard", () => ({
  assertSafeMediaUrl: jest.fn((url: string) => {
    const allowedPrefix = "https://storage.example.com/";
    if (!url.startsWith(allowedPrefix)) {
      throw new Error(`SSRF guard: mediaUrl must start with ${allowedPrefix}`);
    }
  }),
}));

import { POST } from "@/app/api/feedback/submit/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { createIssue } from "@/lib/github";
import { reportServerError } from "@/lib/server-error-reporter";
import type { Feedback } from "@prisma/client";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockCreateIssue = createIssue as jest.MockedFunction<typeof createIssue>;
const mockReportServerError = reportServerError as jest.MockedFunction<
  typeof reportServerError
>;

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/feedback/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: "fb-1",
    userId: "user-1",
    message: "Something is broken",
    pageUrl: null,
    screenshotUrl: null,
    status: "PENDING",
    githubIssueNumber: null,
    githubIssueUrl: null,
    conversationHistory: null,
    metadata: null,
    createdAt: new Date("2026-03-14T00:00:00Z"),
    updatedAt: new Date("2026-03-14T00:00:00Z"),
    ...overrides,
  };
}

const validPayload = {
  messages: [
    { role: "user", content: "The dashboard is broken" },
    { role: "assistant", content: "I understand. Can you describe the issue?" },
    { role: "user", content: "The chart doesn't load" },
  ],
  summary: "Dashboard chart not loading",
  classification: "bug" as const,
  context: {
    pageUrl: "http://localhost:3000/dashboard",
  },
};

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { id: "user-1", name: "Josh", email: "josh@example.com" },
    expires: "2099-01-01",
  });
});

describe("POST /api/feedback/submit", () => {
  it("returns 401 without session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid payload — missing messages", async () => {
    const res = await POST(
      makeRequest({ summary: "test", classification: "bug", context: {} })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid payload — missing summary", async () => {
    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        classification: "bug",
        context: {},
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid classification", async () => {
    const res = await POST(
      makeRequest({
        messages: [{ role: "user", content: "hi" }],
        summary: "test",
        classification: "invalid",
        context: {},
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/feedback/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 for screenshotUrl failing SSRF guard", async () => {
    const res = await POST(
      makeRequest({
        ...validPayload,
        context: {
          screenshotUrl: "https://evil.com/image.png",
        },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/screenshot/i);
  });

  it("creates Feedback record with conversationHistory and summary", async () => {
    const created = mockFeedback({ id: "fb-1", status: "PENDING" });
    const updated = mockFeedback({
      id: "fb-1",
      status: "ISSUE_CREATED",
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/repo/issues/42",
    });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: "test",
      html_url: "https://github.com/repo/issues/42",
    });

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    expect(prismaMock.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        message: "Dashboard chart not loading",
        conversationHistory: validPayload.messages,
        status: "PENDING",
      }),
    });
  });

  it("calls createIssue with bug-formatted title, body, and labels", async () => {
    const created = mockFeedback({ id: "fb-1" });
    const updated = mockFeedback({ id: "fb-1", status: "ISSUE_CREATED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: "test",
      html_url: "https://github.com/repo/issues/42",
    });

    await POST(makeRequest(validPayload));

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Bug\] /),
      expect.stringContaining("Steps to Reproduce"),
      ["bug", "needs-human-review"]
    );
  });

  it("calls createIssue with feature-formatted title and labels", async () => {
    const created = mockFeedback({ id: "fb-1" });
    const updated = mockFeedback({ id: "fb-1", status: "ISSUE_CREATED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 43,
      title: "test",
      html_url: "https://github.com/repo/issues/43",
    });

    await POST(
      makeRequest({
        ...validPayload,
        classification: "feature",
        summary: "Add dark mode",
      })
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Feature\] /),
      expect.stringContaining("Use Case"),
      ["enhancement", "needs-human-review"]
    );
  });

  it("calls createIssue with general-formatted title and labels", async () => {
    const created = mockFeedback({ id: "fb-1" });
    const updated = mockFeedback({ id: "fb-1", status: "ISSUE_CREATED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 44,
      title: "test",
      html_url: "https://github.com/repo/issues/44",
    });

    await POST(
      makeRequest({
        ...validPayload,
        classification: "general",
        summary: "Great app overall",
      })
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.stringMatching(/^\[Feedback\] /),
      expect.any(String),
      ["needs-human-review"]
    );
  });

  it("updates status to ISSUE_CREATED on success", async () => {
    const created = mockFeedback({ id: "fb-1" });
    const updated = mockFeedback({
      id: "fb-1",
      status: "ISSUE_CREATED",
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/repo/issues/42",
    });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 42,
      title: "test",
      html_url: "https://github.com/repo/issues/42",
    });

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-1");
    expect(body.githubIssueNumber).toBe(42);
    expect(body.githubIssueUrl).toBe("https://github.com/repo/issues/42");

    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: "fb-1" },
      data: {
        status: "ISSUE_CREATED",
        githubIssueNumber: 42,
        githubIssueUrl: "https://github.com/repo/issues/42",
      },
    });
  });

  it("updates status to FAILED when createIssue throws", async () => {
    const created = mockFeedback({ id: "fb-2" });
    const updated = mockFeedback({ id: "fb-2", status: "FAILED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockRejectedValue(new Error("GitHub API error"));

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-2");
    expect(body.githubIssueNumber).toBeUndefined();

    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: "fb-2" },
      data: { status: "FAILED" },
    });
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("leaves PENDING status when GitHub token not configured", async () => {
    const created = mockFeedback({ id: "fb-3" });
    prismaMock.feedback.create.mockResolvedValue(created);
    mockCreateIssue.mockRejectedValue(
      new Error(
        "GitHub client not configured — GITHUB_TOKEN or repo params missing"
      )
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    expect(prismaMock.feedback.update).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it("returns 500 when database create fails", async () => {
    prismaMock.feedback.create.mockRejectedValue(
      new Error("connection refused")
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(500);
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("includes screenshotUrl in issue body when provided", async () => {
    const screenshotUrl = "https://storage.example.com/uploads/screenshot.png";
    const created = mockFeedback({ id: "fb-4" });
    const updated = mockFeedback({ id: "fb-4", status: "ISSUE_CREATED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 45,
      title: "test",
      html_url: "https://github.com/repo/issues/45",
    });

    await POST(
      makeRequest({
        ...validPayload,
        context: { screenshotUrl },
      })
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(screenshotUrl),
      expect.any(Array)
    );
  });
});
