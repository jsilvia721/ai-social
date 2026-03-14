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
    // Simulate real behavior: only allow URLs starting with test S3 URL
    const allowedPrefix = "https://storage.example.com/";
    if (!url.startsWith(allowedPrefix)) {
      throw new Error(`SSRF guard: mediaUrl must start with ${allowedPrefix}`);
    }
  }),
}));

import { POST } from "@/app/api/feedback/route";
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
  return new NextRequest("http://localhost/api/feedback", {
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
    metadata: null,
    createdAt: new Date("2026-03-14T00:00:00Z"),
    updatedAt: new Date("2026-03-14T00:00:00Z"),
    ...overrides,
  };
}

const validPayload = {
  message: "The dashboard chart is not loading correctly",
};

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { id: "user-1", name: "Josh", email: "josh@example.com" },
    expires: "2099-01-01",
  });
});

describe("POST /api/feedback", () => {
  it("returns 401 without session", async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when message is empty string", async () => {
    const res = await POST(makeRequest({ message: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds 5000 characters", async () => {
    const res = await POST(makeRequest({ message: "a".repeat(5001) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid pageUrl", async () => {
    const res = await POST(
      makeRequest({ message: "feedback", pageUrl: "not-a-url" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid screenshotUrl", async () => {
    const res = await POST(
      makeRequest({ message: "feedback", screenshotUrl: "not-a-url" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for screenshotUrl not starting with S3 public URL", async () => {
    const res = await POST(
      makeRequest({
        message: "feedback",
        screenshotUrl: "https://evil.com/image.png",
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/screenshot/i);
  });

  it("creates feedback and GitHub issue on happy path (text only)", async () => {
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
      title: "The dashboard chart is not loading correctly",
      html_url: "https://github.com/repo/issues/42",
    });

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-1");
    expect(body.githubIssueNumber).toBe(42);
    expect(body.githubIssueUrl).toBe("https://github.com/repo/issues/42");

    // Verify DB create was called
    expect(prismaMock.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        message: validPayload.message,
        status: "PENDING",
      }),
    });

    // Verify createIssue was called with needs-triage label
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("User Feedback"),
      ["needs-triage"]
    );

    // Verify DB update to ISSUE_CREATED
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: "fb-1" },
      data: {
        status: "ISSUE_CREATED",
        githubIssueNumber: 42,
        githubIssueUrl: "https://github.com/repo/issues/42",
      },
    });
  });

  it("creates feedback with screenshot URL in GitHub issue body", async () => {
    const screenshotUrl = "https://storage.example.com/uploads/screenshot.png";
    const created = mockFeedback({ id: "fb-2", screenshotUrl });
    const updated = mockFeedback({
      id: "fb-2",
      status: "ISSUE_CREATED",
      githubIssueNumber: 43,
      githubIssueUrl: "https://github.com/repo/issues/43",
    });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockResolvedValue({
      number: 43,
      title: "feedback with screenshot",
      html_url: "https://github.com/repo/issues/43",
    });

    const res = await POST(
      makeRequest({
        message: "feedback with screenshot",
        screenshotUrl,
      })
    );
    expect(res.status).toBe(201);

    // Verify screenshot is in the GitHub issue body
    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(screenshotUrl),
      ["needs-triage"]
    );
  });

  it("returns 201 and saves with FAILED status when GitHub createIssue throws", async () => {
    const created = mockFeedback({ id: "fb-3" });
    const updated = mockFeedback({ id: "fb-3", status: "FAILED" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(updated);
    mockCreateIssue.mockRejectedValue(new Error("GitHub API error"));

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-3");
    expect(body.githubIssueNumber).toBeUndefined();

    // Verify DB update to FAILED
    expect(prismaMock.feedback.update).toHaveBeenCalledWith({
      where: { id: "fb-3" },
      data: { status: "FAILED" },
    });

    // Verify reportServerError was called
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("returns 201 with PENDING status when GitHub token is not configured", async () => {
    const created = mockFeedback({ id: "fb-4" });
    prismaMock.feedback.create.mockResolvedValue(created);
    mockCreateIssue.mockRejectedValue(
      new Error("GitHub client not configured — GITHUB_TOKEN or repo params missing")
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-4");

    // Should NOT update status to FAILED or call reportServerError
    expect(prismaMock.feedback.update).not.toHaveBeenCalled();
    expect(mockReportServerError).not.toHaveBeenCalled();
  });

  it("returns 201 even when DB update to FAILED itself fails", async () => {
    const created = mockFeedback({ id: "fb-4b" });
    prismaMock.feedback.create.mockResolvedValue(created);
    mockCreateIssue.mockRejectedValue(new Error("GitHub API error"));
    prismaMock.feedback.update.mockRejectedValue(
      new Error("DB connection lost")
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("fb-4b");
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("accepts optional metadata", async () => {
    const metadata = { userAgent: "Mozilla/5.0", viewport: "1024x768" };
    const created = mockFeedback({ id: "fb-5", metadata });
    prismaMock.feedback.create.mockResolvedValue(created);
    mockCreateIssue.mockResolvedValue({
      number: 44,
      title: "test",
      html_url: "https://github.com/repo/issues/44",
    });
    prismaMock.feedback.update.mockResolvedValue(
      mockFeedback({ id: "fb-5", status: "ISSUE_CREATED" })
    );

    const res = await POST(
      makeRequest({ ...validPayload, metadata })
    );
    expect(res.status).toBe(201);

    expect(prismaMock.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata }),
    });
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("truncates issue title on word boundary at 80 chars", async () => {
    const longMessage =
      "This is a very long feedback message that should be truncated on a word boundary when used as the GitHub issue title";
    const created = mockFeedback({ id: "fb-6", message: longMessage });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(
      mockFeedback({ id: "fb-6", status: "ISSUE_CREATED" })
    );
    mockCreateIssue.mockResolvedValue({
      number: 45,
      title: "truncated",
      html_url: "https://github.com/repo/issues/45",
    });

    await POST(makeRequest({ message: longMessage }));

    const titleArg = mockCreateIssue.mock.calls[0][0];
    expect(titleArg.length).toBeLessThanOrEqual(80);
    expect(titleArg).toMatch(/…$/);
  });

  it("includes pageUrl in GitHub issue body", async () => {
    const created = mockFeedback({ id: "fb-7" });
    prismaMock.feedback.create.mockResolvedValue(created);
    prismaMock.feedback.update.mockResolvedValue(
      mockFeedback({ id: "fb-7", status: "ISSUE_CREATED" })
    );
    mockCreateIssue.mockResolvedValue({
      number: 46,
      title: "test",
      html_url: "https://github.com/repo/issues/46",
    });

    await POST(
      makeRequest({
        message: "feedback",
        pageUrl: "http://localhost:3000/dashboard",
      })
    );

    expect(mockCreateIssue).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("http://localhost:3000/dashboard"),
      ["needs-triage"]
    );
  });

  it("returns 500 when database create fails", async () => {
    prismaMock.feedback.create.mockRejectedValue(
      new Error("connection refused")
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(500);

    expect(mockReportServerError).toHaveBeenCalled();
  });
});
