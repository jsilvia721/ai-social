/**
 * Tests for brainstorm promotion — checked items become Plan issues.
 */

// Mock GitHub client
const mockGetIssue = jest.fn();
const mockUpdateIssueBody = jest.fn();
const mockCreateIssue = jest.fn();
const mockListIssues = jest.fn();
const mockCloseIssue = jest.fn();
const mockListComments = jest.fn();

jest.mock("@/lib/github", () => ({
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

/** Helper to set mockGetIssue with a given body and state */
function setIssue(body: string, state = "open") {
  mockGetIssue.mockResolvedValue({
    number: 42,
    title: "Brainstorm: Week of Jan 1",
    body,
    state,
    labels: [{ name: "brainstorm" }],
    html_url: "https://github.com/test/issues/42",
  });
}

describe("promoteBrainstormItems", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setIssue(BODY_UNCHECKED);
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
    const session = makeSession();
    await promoteBrainstormItems(session);
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("creates a plan issue for a checked item", async () => {
    setIssue(BODY_ONE_CHECKED);
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
    setIssue(BODY_ONE_CHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockUpdateIssueBody).toHaveBeenCalled();
    const updatedBody = mockUpdateIssueBody.mock.calls[0][1] as string;
    expect(updatedBody).toContain("→ [Plan #99]");
  });

  it("increments approvedCount in DB (batched)", async () => {
    setIssue(BODY_ONE_CHECKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { approvedCount: { increment: 1 } },
    });
  });

  it("skips already-linked items", async () => {
    setIssue(BODY_ALREADY_LINKED);
    const session = makeSession();

    await promoteBrainstormItems(session);

    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it("deduplicates — skips if plan issue with same title already exists", async () => {
    setIssue(BODY_ONE_CHECKED);
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

  it("continues promoting remaining items when one createIssue fails", async () => {
    const bodyBothChecked = `## 💡 Ideas

- [x] **1. Feature One**
  **Rationale:** Important for growth.
  **Scope:** Small
  **Category:** Intelligence
  **Vision Alignment:** Core to vision.

- [x] **2. Feature Two**
  **Rationale:** Improves UX.
  **Scope:** Medium
  **Category:** UX
  **Vision Alignment:** User experience.`;
    setIssue(bodyBothChecked);

    // First call fails, second succeeds
    mockCreateIssue
      .mockRejectedValueOnce(new Error("API rate limit exceeded"))
      .mockResolvedValueOnce({
        number: 100,
        title: "Plan: Feature Two",
        html_url: "https://github.com/test/issues/100",
      });

    const session = makeSession();
    await promoteBrainstormItems(session);

    // Both items attempted
    expect(mockCreateIssue).toHaveBeenCalledTimes(2);
    // Only the successful one is counted
    expect(mockSessionUpdate).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { approvedCount: { increment: 1 } },
    });
    // Body updated with the successful plan link only
    expect(mockUpdateIssueBody).toHaveBeenCalled();
    const updatedBody = mockUpdateIssueBody.mock.calls[0][1] as string;
    expect(updatedBody).toContain("→ [Plan #100]");
    expect(updatedBody).not.toContain("→ [Plan #99]");
  });

  describe("auto-close", () => {
    it("closes issue when all items resolved and no recent comments", async () => {
      setIssue(BODY_ALL_RESOLVED);
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
      setIssue(BODY_ALL_RESOLVED);
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

  it("skips item and allows retry when createIssue returns number 0", async () => {
    setIssue(BODY_ONE_CHECKED);
    mockCreateIssue.mockResolvedValue({
      number: 0,
      title: "Plan: Feature One",
      html_url: "",
    });
    const session = makeSession();
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();

    await promoteBrainstormItems(session);

    // Should not update issue body or increment approvedCount
    expect(mockUpdateIssueBody).not.toHaveBeenCalled();
    expect(mockSessionUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ approvedCount: expect.anything() }),
      }),
    );
    // Should log a warning
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Feature One"),
    );
    warnSpy.mockRestore();
  });

  it("syncs status to CLOSED when GitHub issue is already closed", async () => {
    setIssue(BODY_UNCHECKED, "closed");
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
