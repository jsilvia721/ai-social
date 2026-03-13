/**
 * Tests for brainstorm promotion — checked items become Plan issues.
 */

// Mock GitHub client
const mockGetIssueBody = jest.fn();
const mockGetIssue = jest.fn();
const mockUpdateIssueBody = jest.fn();
const mockCreateIssue = jest.fn();
const mockListIssues = jest.fn();
const mockCloseIssue = jest.fn();
const mockListComments = jest.fn();

jest.mock("@/lib/github", () => ({
  getIssueBody: (...args: unknown[]) => mockGetIssueBody(...args),
  getIssue: (...args: unknown[]) => mockGetIssue(...args),
  updateIssueBody: (...args: unknown[]) => mockUpdateIssueBody(...args),
  createIssue: (...args: unknown[]) => mockCreateIssue(...args),
  listIssues: (...args: unknown[]) => mockListIssues(...args),
  closeIssue: (...args: unknown[]) => mockCloseIssue(...args),
  listComments: (...args: unknown[]) => mockListComments(...args),
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
    GITHUB_REPO_OWNER: "test-owner",
    GITHUB_REPO_NAME: "test-repo",
  },
}));

// Mock config
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn().mockReturnValue(false),
}));

import { promoteBrainstormItems } from "@/lib/brainstorm/promote";

const makeSession = (overrides = {}) => ({
  id: "session-1",
  githubIssueNumber: 42,
  status: "OPEN",
  lastProcessedCommentId: null as number | null,
  itemCount: 2,
  approvedCount: 0,
  closedAt: null as Date | null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const BODY_UNCHECKED = `## 💡 Ideas

- [ ] **1. Feature One**
  **Rationale:** Important for growth.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core to vision.

- [ ] **2. Feature Two**
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.`;

const BODY_ONE_CHECKED = `## 💡 Ideas

- [x] **1. Feature One**
  **Rationale:** Important for growth.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core to vision.

- [ ] **2. Feature Two**
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.`;

const BODY_ALREADY_LINKED = `## 💡 Ideas

- [x] **1. Feature One** → [Plan #99](https://github.com/test/issues/99)
  **Rationale:** Important for growth.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core to vision.

- [ ] **2. Feature Two**
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.`;

const BODY_ALL_RESOLVED = `## 💡 Ideas

- [x] **1. Feature One** → [Plan #99](https://github.com/test/issues/99)
  **Rationale:** Important.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core.

- [x] **2. Feature Two** → [Plan #100](https://github.com/test/issues/100)
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.`;

describe("promoteBrainstormItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIssue.mockResolvedValue({
      number: 42,
      title: "Brainstorm: Week of Jan 1",
      body: BODY_UNCHECKED,
      state: "open",
      labels: [{ name: "brainstorm" }],
      html_url: "https://github.com/test/issues/42",
    });
    mockGetIssueBody.mockResolvedValue(BODY_UNCHECKED);
    mockListIssues.mockResolvedValue([]);
    mockCreateIssue.mockResolvedValue({
      number: 99,
      title: "Plan: Feature One",
      html_url: "https://github.com/test/issues/99",
    });
    mockUpdateIssueBody.mockResolvedValue(undefined);
    mockCloseIssue.mockResolvedValue(undefined);
    mockListComments.mockResolvedValue([]);
  });

  it("does nothing when no items are checked", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_UNCHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("creates a plan issue for a checked item", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_ONE_CHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockCreateIssue).toHaveBeenCalledTimes(1);
    const [title, body, labels] = mockCreateIssue.mock.calls[0];
    expect(title).toBe("Plan: Feature One");
    expect(body).toContain("#42"); // links back to brainstorm
    expect(body).toContain("Important for growth"); // rationale
    expect(body).toContain("Small"); // scope
    expect(labels).toEqual(["plan"]);
  });

  it("updates brainstorm issue body with plan link", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_ONE_CHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockUpdateIssueBody).toHaveBeenCalled();
    const updatedBody = mockUpdateIssueBody.mock.calls[0][1] as string;
    expect(updatedBody).toContain("→ [Plan #99]");
  });

  it("increments approvedCount in DB", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_ONE_CHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { approvedCount: { increment: 1 } },
    });
  });

  it("skips already-linked items", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_ALREADY_LINKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("deduplicates — skips if plan issue with same title already exists", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_ONE_CHECKED);
    mockListIssues.mockResolvedValue([
      {
        number: 88,
        title: "Plan: Feature One",
        body: "",
        state: "open",
        labels: [{ name: "plan" }],
        html_url: "https://github.com/test/issues/88",
      },
    ]);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  describe("auto-close", () => {
    it("closes issue when all items resolved and no recent comments", async () => {
      mockGetIssueBody.mockResolvedValue(BODY_ALL_RESOLVED);
      mockGetIssue.mockResolvedValue({
        number: 42,
        title: "Brainstorm",
        body: BODY_ALL_RESOLVED,
        state: "open",
        labels: [],
        html_url: "",
      });
      // Last comment was 2 days ago
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      mockListComments.mockResolvedValue([
        {
          id: 50,
          body: "Old comment",
          user: { login: "josh" },
          created_at: twoDaysAgo,
        },
      ]);
      const session = makeSession();

      await promoteBrainstormItems(session);

      expect(mockCloseIssue).toHaveBeenCalledWith(42);
      expect(mockSessionUpdate).toHaveBeenCalledWith({
        where: { id: "session-1" },
        data: {
          status: "CLOSED",
          closedAt: expect.any(Date),
        },
      });
    });

    it("does not close when comments are recent (< 24h)", async () => {
      mockGetIssueBody.mockResolvedValue(BODY_ALL_RESOLVED);
      mockGetIssue.mockResolvedValue({
        number: 42,
        title: "Brainstorm",
        body: BODY_ALL_RESOLVED,
        state: "open",
        labels: [],
        html_url: "",
      });
      // Last comment was 1 hour ago
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockListComments.mockResolvedValue([
        {
          id: 50,
          body: "Recent comment",
          user: { login: "josh" },
          created_at: oneHourAgo,
        },
      ]);
      const session = makeSession();

      await promoteBrainstormItems(session);

      expect(mockCloseIssue).not.toHaveBeenCalled();
    });
  });

  it("syncs status to CLOSED when GitHub issue is already closed", async () => {
    mockGetIssueBody.mockResolvedValue(BODY_UNCHECKED);
    mockGetIssue.mockResolvedValue({
      number: 42,
      title: "Brainstorm",
      body: BODY_UNCHECKED,
      state: "closed",
      labels: [],
      html_url: "",
    });
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: {
        status: "CLOSED",
        closedAt: expect.any(Date),
      },
    });
  });
});
