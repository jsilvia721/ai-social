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

// Mock Prisma
const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    brainstormSession: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
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
    // Override env for this test
    const envModule = await import("@/env");
    const originalToken = envModule.env.GITHUB_TOKEN;
    (envModule.env as Record<string, unknown>).GITHUB_TOKEN = undefined;

    await runBrainstormAgent();

    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();

    // Restore
    (envModule.env as Record<string, unknown>).GITHUB_TOKEN = originalToken;
  });

  it("returns early when shouldMockExternalApis is true", async () => {
    mockShouldMock.mockReturnValue(true);

    await runBrainstormAgent();

    expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  describe("no open session", () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([]);
    });

    it("generates a new brainstorm when no previous session exists", async () => {
      mockFindFirst.mockResolvedValue(null);

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    });

    it("generates when cooldown has passed", async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      mockFindFirst.mockResolvedValue(
        makeSession({ status: "CLOSED", closedAt: tenDaysAgo }),
      );

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).toHaveBeenCalledTimes(1);
    });

    it("does NOT generate when cooldown has NOT passed", async () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      mockFindFirst.mockResolvedValue(
        makeSession({ status: "CLOSED", closedAt: twoDaysAgo }),
      );

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    });
  });

  describe("open session exists", () => {
    it("runs iterate then promote (sequential)", async () => {
      const session = makeSession();
      mockFindMany.mockResolvedValue([session]);

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
      mockFindMany.mockResolvedValue([makeSession()]);

      await runBrainstormAgent();

      expect(mockGenerateBrainstorm).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("reports errors via reportServerError and continues", async () => {
      const session = makeSession();
      mockFindMany.mockResolvedValue([session]);
      mockIterateBrainstorm.mockRejectedValue(new Error("Iterate failed"));

      await runBrainstormAgent();

      // Should report the error
      expect(mockReportServerError).toHaveBeenCalledWith(
        expect.stringContaining("Iterate failed"),
        expect.any(Object),
      );

      // Should still run promote despite iterate error
      expect(mockPromoteBrainstormItems).toHaveBeenCalledWith(session);
    });

    it("does not crash when promote fails", async () => {
      const session = makeSession();
      mockFindMany.mockResolvedValue([session]);
      mockPromoteBrainstormItems.mockRejectedValue(new Error("Promote failed"));

      // Should not throw
      await expect(runBrainstormAgent()).resolves.not.toThrow();

      expect(mockReportServerError).toHaveBeenCalledWith(
        expect.stringContaining("Promote failed"),
        expect.any(Object),
      );
    });
  });

  describe("deadline enforcement", () => {
    it("respects wall-clock budget", async () => {
      // This is tested indirectly — the function should accept a deadline parameter
      // and check it before each step. We test by passing a deadline in the past.
      const session = makeSession();
      mockFindMany.mockResolvedValue([session]);

      // Pass a deadline that's already expired
      await runBrainstormAgent(Date.now() - 1000);

      // Should not run iterate or promote because deadline expired
      expect(mockIterateBrainstorm).not.toHaveBeenCalled();
      expect(mockPromoteBrainstormItems).not.toHaveBeenCalled();
    });
  });
});
