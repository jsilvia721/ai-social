import {
  PutRuleCommand,
  EnableRuleCommand,
  DisableRuleCommand,
  DescribeRuleCommand,
  ResourceNotFoundException,
  LimitExceededException,
  InternalException,
} from "@aws-sdk/client-eventbridge";

// Mock the EventBridge client — mockSend must be declared before jest.mock
// because jest.mock is hoisted but variable declarations with jest.fn() are too
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-eventbridge", () => ({
  ...jest.requireActual("@aws-sdk/client-eventbridge"),
  EventBridgeClient: jest.fn(() => ({ send: mockSend })),
}));

import {
  updateCronSchedule,
  enableCron,
  disableCron,
  describeCron,
  buildRateExpression,
} from "@/lib/eventbridge";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildRateExpression", () => {
  it("uses singular for value of 1", () => {
    expect(buildRateExpression(1, "minute")).toBe("rate(1 minute)");
    expect(buildRateExpression(1, "hour")).toBe("rate(1 hour)");
    expect(buildRateExpression(1, "day")).toBe("rate(1 day)");
  });

  it("uses plural for values > 1", () => {
    expect(buildRateExpression(5, "minute")).toBe("rate(5 minutes)");
    expect(buildRateExpression(2, "hour")).toBe("rate(2 hours)");
    expect(buildRateExpression(30, "day")).toBe("rate(30 days)");
  });
});

describe("updateCronSchedule", () => {
  it("returns no-op when env var is missing", async () => {
    delete process.env.PUBLISH_RULE_NAME;
    const result = await updateCronSchedule("publish", "rate(1 minute)");
    expect(result).toEqual({ success: false, reason: "no-rule-name" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends PutRuleCommand on success", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockResolvedValue({ RuleArn: "arn:aws:events:us-east-1:123:rule/my-publish-rule" });

    const result = await updateCronSchedule("publish", "rate(1 minute)");
    expect(result).toEqual({ success: true, ruleArn: "arn:aws:events:us-east-1:123:rule/my-publish-rule" });

    const call = mockSend.mock.calls[0][0];
    expect(call).toBeInstanceOf(PutRuleCommand);
    expect(call.input).toEqual({
      Name: "my-publish-rule",
      ScheduleExpression: "rate(1 minute)",
    });
  });

  it("handles metrics cron", async () => {
    process.env.METRICS_RULE_NAME = "my-metrics-rule";
    mockSend.mockResolvedValue({ RuleArn: "arn:aws:events:us-east-1:123:rule/my-metrics-rule" });

    const result = await updateCronSchedule("metrics", "rate(1 hour)");
    expect(result).toEqual({ success: true, ruleArn: "arn:aws:events:us-east-1:123:rule/my-metrics-rule" });
  });

  it("handles ResourceNotFoundException", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(
      new ResourceNotFoundException({ message: "Rule not found", $metadata: {} })
    );

    const result = await updateCronSchedule("publish", "rate(1 minute)");
    expect(result).toEqual({
      success: false,
      reason: "not-found",
      message: "Rule not found",
    });
  });

  it("handles LimitExceededException", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(
      new LimitExceededException({ message: "Rate exceeded", $metadata: {} })
    );

    const result = await updateCronSchedule("publish", "rate(1 minute)");
    expect(result).toEqual({
      success: false,
      reason: "rate-limited",
      message: "Rate exceeded",
    });
  });

  it("handles InternalException", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(
      new InternalException({ message: "Internal error", $metadata: {} })
    );

    const result = await updateCronSchedule("publish", "rate(1 minute)");
    expect(result).toEqual({
      success: false,
      reason: "internal-error",
      message: "Internal error",
    });
  });

  it("rethrows unexpected errors", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(new Error("unexpected"));

    await expect(updateCronSchedule("publish", "rate(1 minute)")).rejects.toThrow("unexpected");
  });
});

describe("enableCron", () => {
  it("returns no-op when env var is missing", async () => {
    delete process.env.PUBLISH_RULE_NAME;
    const result = await enableCron("publish");
    expect(result).toEqual({ success: false, reason: "no-rule-name" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends EnableRuleCommand on success", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockResolvedValue({});

    const result = await enableCron("publish");
    expect(result).toEqual({ success: true });

    const call = mockSend.mock.calls[0][0];
    expect(call).toBeInstanceOf(EnableRuleCommand);
    expect(call.input).toEqual({ Name: "my-publish-rule" });
  });

  it("handles ResourceNotFoundException", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(
      new ResourceNotFoundException({ message: "Not found", $metadata: {} })
    );

    const result = await enableCron("publish");
    expect(result).toEqual({ success: false, reason: "not-found", message: "Not found" });
  });
});

describe("disableCron", () => {
  it("returns no-op when env var is missing", async () => {
    delete process.env.METRICS_RULE_NAME;
    const result = await disableCron("metrics");
    expect(result).toEqual({ success: false, reason: "no-rule-name" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends DisableRuleCommand on success", async () => {
    process.env.METRICS_RULE_NAME = "my-metrics-rule";
    mockSend.mockResolvedValue({});

    const result = await disableCron("metrics");
    expect(result).toEqual({ success: true });

    const call = mockSend.mock.calls[0][0];
    expect(call).toBeInstanceOf(DisableRuleCommand);
    expect(call.input).toEqual({ Name: "my-metrics-rule" });
  });
});

describe("describeCron", () => {
  it("returns no-op when env var is missing", async () => {
    delete process.env.PUBLISH_RULE_NAME;
    const result = await describeCron("publish");
    expect(result).toEqual({ success: false, reason: "no-rule-name" });
  });

  it("returns rule details on success", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockResolvedValue({
      Name: "my-publish-rule",
      Arn: "arn:aws:events:us-east-1:123:rule/my-publish-rule",
      State: "ENABLED",
      ScheduleExpression: "rate(1 minute)",
    });

    const result = await describeCron("publish");
    expect(result).toEqual({
      success: true,
      rule: {
        name: "my-publish-rule",
        arn: "arn:aws:events:us-east-1:123:rule/my-publish-rule",
        state: "ENABLED",
        scheduleExpression: "rate(1 minute)",
      },
    });

    const call = mockSend.mock.calls[0][0];
    expect(call).toBeInstanceOf(DescribeRuleCommand);
    expect(call.input).toEqual({ Name: "my-publish-rule" });
  });

  it("handles ResourceNotFoundException", async () => {
    process.env.PUBLISH_RULE_NAME = "my-publish-rule";
    mockSend.mockRejectedValue(
      new ResourceNotFoundException({ message: "Not found", $metadata: {} })
    );

    const result = await describeCron("publish");
    expect(result).toEqual({ success: false, reason: "not-found", message: "Not found" });
  });
});

afterEach(() => {
  delete process.env.PUBLISH_RULE_NAME;
  delete process.env.METRICS_RULE_NAME;
});
