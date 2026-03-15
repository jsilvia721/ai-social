/**
 * Tests for the sync-cron-config script logic.
 *
 * We test the core syncCronConfig function which is exported from the script.
 * The script's main() is a thin wrapper that calls syncCronConfig and exits.
 */

// Mock the EventBridge client — must be declared before jest.mock
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-eventbridge", () => ({
  ...jest.requireActual("@aws-sdk/client-eventbridge"),
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
}));

// Mock Prisma
const mockFindMany = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    cronConfig: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

import { syncCronConfig } from "../../../scripts/sync-cron-config";

// Set up rule name env vars for all crons
const RULE_NAMES: Record<string, string> = {
  PUBLISH_RULE_NAME: "ai-social-publish-rule",
  METRICS_RULE_NAME: "ai-social-metrics-rule",
  RESEARCH_RULE_NAME: "ai-social-research-rule",
  BRIEFS_RULE_NAME: "ai-social-briefs-rule",
  FULFILL_RULE_NAME: "ai-social-fulfill-rule",
  OPTIMIZE_RULE_NAME: "ai-social-optimize-rule",
  BRAINSTORM_RULE_NAME: "ai-social-brainstorm-rule",
};

beforeEach(() => {
  jest.clearAllMocks();
  // Set all rule name env vars
  for (const [key, value] of Object.entries(RULE_NAMES)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  // Clean up env vars
  for (const key of Object.keys(RULE_NAMES)) {
    delete process.env[key];
  }
});

// Default schedule expressions from sst.config.ts
const DEFAULT_SCHEDULES: Record<string, string> = {
  publish: "rate(1 minute)",
  metrics: "rate(60 minutes)",
  research: "cron(0 */4 * * ? *)",
  briefs: "cron(0 23 ? * SUN *)",
  fulfill: "rate(6 hours)",
  optimize: "cron(0 2 ? * SUN *)",
  brainstorm: "rate(60 minutes)",
};

function makeCronConfig(
  cronName: string,
  overrides: Partial<{
    scheduleExpression: string;
    enabled: boolean;
    syncStatus: string;
  }> = {}
) {
  return {
    id: `id-${cronName}`,
    cronName,
    scheduleExpression:
      overrides.scheduleExpression ?? DEFAULT_SCHEDULES[cronName],
    scheduleType: DEFAULT_SCHEDULES[cronName].startsWith("rate")
      ? "rate"
      : "cron",
    enabled: overrides.enabled ?? true,
    syncStatus: overrides.syncStatus ?? "SYNCED",
    updatedAt: new Date(),
  };
}

describe("syncCronConfig", () => {
  it("returns no-op when CronConfig table is empty", async () => {
    mockFindMany.mockResolvedValue([]);

    const result = await syncCronConfig();

    expect(result.total).toBe(0);
    expect(result.synced).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("returns no-op when all configs match defaults and are enabled", async () => {
    const configs = Object.keys(DEFAULT_SCHEDULES).map((name) =>
      makeCronConfig(name)
    );
    mockFindMany.mockResolvedValue(configs);

    const result = await syncCronConfig();

    expect(result.total).toBe(7);
    expect(result.synced).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("re-applies custom schedule expression to EventBridge", async () => {
    const configs = [
      makeCronConfig("publish", {
        scheduleExpression: "rate(5 minutes)",
      }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({ RuleArn: "arn:rule" });
    mockUpdate.mockResolvedValue({});

    const result = await syncCronConfig();

    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);
    // Should have called PutRuleCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.input).toEqual({
      Name: "ai-social-publish-rule",
      ScheduleExpression: "rate(5 minutes)",
    });
  });

  it("disables a cron that is disabled in CronConfig", async () => {
    const configs = [
      makeCronConfig("metrics", { enabled: false }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({});
    mockUpdate.mockResolvedValue({});

    const result = await syncCronConfig();

    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);
    // Should have called DisableRuleCommand
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("handles both custom schedule and disabled state", async () => {
    const configs = [
      makeCronConfig("research", {
        scheduleExpression: "cron(0 */2 * * ? *)",
        enabled: false,
      }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({ RuleArn: "arn:rule" });
    mockUpdate.mockResolvedValue({});

    const result = await syncCronConfig();

    expect(result.synced).toBe(1);
    expect(result.errors).toBe(0);
    // Should call PutRuleCommand for schedule, then DisableRuleCommand
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("counts errors when EventBridge calls fail", async () => {
    const configs = [
      makeCronConfig("publish", {
        scheduleExpression: "rate(5 minutes)",
      }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockRejectedValue(new Error("AWS error"));

    const result = await syncCronConfig();

    expect(result.synced).toBe(0);
    expect(result.errors).toBe(1);
  });

  it("skips crons with no rule name env var", async () => {
    delete process.env.PUBLISH_RULE_NAME;
    const configs = [
      makeCronConfig("publish", {
        scheduleExpression: "rate(5 minutes)",
      }),
    ];
    mockFindMany.mockResolvedValue(configs);

    const result = await syncCronConfig();

    expect(result.synced).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("updates syncStatus to SYNCED on success", async () => {
    const configs = [
      makeCronConfig("fulfill", {
        scheduleExpression: "rate(12 hours)",
        syncStatus: "PENDING",
      }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({ RuleArn: "arn:rule" });
    mockUpdate.mockResolvedValue({});

    await syncCronConfig();

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { cronName: "fulfill" },
      data: { syncStatus: "SYNCED" },
    });
  });

  it("is idempotent — running twice produces the same result", async () => {
    const configs = [
      makeCronConfig("brainstorm", {
        scheduleExpression: "rate(30 minutes)",
      }),
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({ RuleArn: "arn:rule" });
    mockUpdate.mockResolvedValue({});

    const result1 = await syncCronConfig();
    const result2 = await syncCronConfig();

    expect(result1.synced).toBe(result2.synced);
    expect(result1.errors).toBe(result2.errors);
  });

  it("handles mixed configs — some default, some custom, some disabled", async () => {
    const configs = [
      makeCronConfig("publish"), // default — no action
      makeCronConfig("metrics", { scheduleExpression: "rate(30 minutes)" }), // custom schedule
      makeCronConfig("research"), // default — no action
      makeCronConfig("briefs", { enabled: false }), // disabled
      makeCronConfig("fulfill"), // default — no action
      makeCronConfig("optimize"), // default — no action
      makeCronConfig("brainstorm", {
        scheduleExpression: "rate(30 minutes)",
        enabled: false,
      }), // custom + disabled
    ];
    mockFindMany.mockResolvedValue(configs);
    mockSend.mockResolvedValue({ RuleArn: "arn:rule" });
    mockUpdate.mockResolvedValue({});

    const result = await syncCronConfig();

    expect(result.total).toBe(7);
    expect(result.synced).toBe(3); // metrics, briefs, brainstorm
    expect(result.errors).toBe(0);
  });
});
