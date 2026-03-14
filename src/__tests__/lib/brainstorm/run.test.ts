/**
 * Tests for brainstorm orchestrator — ties generation, iteration, and promotion together.
 */

// Mock sub-modules
const mockGenerateBrainstorm = jest.fn();
const mockIterateBrainstorm = jest.fn();
const mockPromoteBrainstormItems = jest.fn();

jest.mock("@/lib/brainstorm/generate", () => ({
  generateBrainstorm: (...args: unknown[]) => mockGenerateBrainstorm(...args),
}));

jest.mock("@/lib/brainstorm/iterate", () => ({
  iterateBrainstorm: (...args: unknown[]) => mockIterateBrainstorm(...args),
}));

jest.mock("@/lib/brainstorm/promote", () => ({
  promoteBrainstormItems: (...args: unknown[]) => mockPromoteBrainstormItems(...args),
}));

// Mock Prisma — findFirst is called twice: first for open session, then for cooldown
const mockFindFirst = jest.fn();
const mockUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
jest.mock("@/lib/db", () => ({
  prisma: {
    brainstormSession: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

// Mock env
jest.mock("@/env", () => ({
  env: {
    GITHUB_TOKEN: "test-token",
    BRAINSTORM_FREQUENCY_DAYS: 7,
  },
}));

// Mock config
const mockShouldMock = jest.fn().mockReturnValue(false);
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: () => mockShouldMock(),
}));

// Mock error reporter
const mockReportServerError = jest.fn();
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: (...args: unknown[]) => mockReportServerError(...args),
}));

import { runBrainstormAgent } from "@/lib/brainstorm/run";

const makeSession = (overrides = {}) => ({
  id: "session-1",
  githubIssueNumber: 42,
  status: "OPEN",
  lastProcessedCommentId: null,
  itemCount: 5,
  approvedCount: 0,
  closedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("runBrainstormAgent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldMock.mockReturnValue(false);
    mockGenerateBrainstorm.mockResolvedValue({ issueNumber: 50, url: "https://github.com/test/issues/50" });
    mockIterateBrainstorm.mockResolvedValue(undefined);
    mockPromoteBrainstormItems.mockResolvedValue(undefined);
  });

  it("returns early when GITHUB_TOKEN is not set", async () => {
    const envModule = await import("@/env");
    const originalToken = envModule.env.GITHUB_TOKEN;
    (envModule.env as Record<string, unknown>).GITHUB_TOKEN = undefined;

    await runBrainstormAgent();

    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();

    (envModule.env as Record<string, unknown>).GITHUB_TOKEN = originalToken;
  });

  it("returns early when shouldMockExternalApis is true", async () => {
    mockShouldMock.mockReturnValue(true);

    await runBrainstormAgent();

    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  describe("startup cleanup", () => {
    it("closes sessions with githubIssueNumber <= 0 before proceeding", async () => {
      mockUpdateMany.mockResolvedValueOnce({ count: 1 });
      mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await runBrainstormAgent();

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          status: "OPEN",
          githubIssueNumber: { lte: 0 },
        },
        data: {
          status: "CLOSED",
          closedAt: expect.any(Date),
        },
      });
      // cleanup runs before findFirst
      const updateManyOrder = mockUpdateMany.mock.invocationCallOrder[0];
      const findFirstOrder = mockFindFirst.mock.invocationCallOrder[0];
      expect(updateManyOrder).toBeLessThan(findFirstOrder);
    });
  });

  describe("no open session", () => {
    it("generates a new brainstorm when no previous session exists", async () => {
      // First call: open session check → null; Second call: last session → null
      mockFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    });

    it("generates when cooldown has passed", async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      // First call: open session → null; Second call: last closed session
      mockFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeSession({ status: "CLOSED", closedAt: tenDaysAgo }));

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    });

    it("does NOT generate when cooldown has NOT passed", async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      mockFindFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeSession({ status: "CLOSED", closedAt: twoDaysAgo }));

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    });
  });

  describe("open session exists", () => {
    it("runs iterate then promote (sequential)", async () => {
      const session = makeSession();
      mockFindFirst.mockResolvedValueOnce(session);

      const callOrder: string[] = [];
      mockIterateBrainstorm.mockImplementation(async () => {
        callOrder.push("iterate");
      });
      mockPromoteBrainstormItems.mockImplementation(async () => {
        callOrder.push("promote");
      });

      await runBrainstormAgent();

      expect(callOrder).toEqual(["iterate", "promote"]);
      expect(mockIterateBrainstorm).toHaveBeenCalledWith(session);
      expect(mockPromoteBrainstormItems).toHaveBeenCalledWith(session);
    });

    it("does NOT generate a new brainstorm when session is open", async () => {
      mockFindFirst.mockResolvedValueOnce(makeSession());

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("reports errors via reportServerError and continues", async () => {
      const session = makeSession();
      mockFindFirst.mockResolvedValueOnce(session);
      mockIterateBrainstorm.mockRejectedValue(new Error("Iterate failed"));

      await runBrainstormAgent();

      expect(mockReportServerError).toHaveBeenCalledWith(
        expect.stringContaining("Iterate failed"),
        expect.any(Object),
      );

      // Should still run promote despite iterate error
      expect(mockPromoteBrainstormItems).toHaveBeenCalledWith(session);
    });

    it("does not crash when promote fails", async () => {
      const session = makeSession();
      mockFindFirst.mockResolvedValueOnce(session);
      mockPromoteBrainstormItems.mockRejectedValue(new Error("Promote failed"));

      await expect(runBrainstormAgent()).resolves.not.toThrow();

      expect(mockReportServerError).toHaveBeenCalledWith(
        expect.stringContaining("Promote failed"),
        expect.any(Object),
      );
    });
  });

  describe("deadline enforcement", () => {
    it("respects wall-clock budget", async () => {
      const session = makeSession();
      mockFindFirst.mockResolvedValueOnce(session);

      // Pass a deadline that's already expired
      await runBrainstormAgent(Date.now() - 1000);

      expect(mockIterateBrainstorm).not.toHaveBeenCalled();
      expect(mockPromoteBrainstormItems).not.toHaveBeenCalled();
    });
  });
});
