import {
  EventBridgeClient,
  PutRuleCommand,
  EnableRuleCommand,
  DisableRuleCommand,
  DescribeRuleCommand,
  ResourceNotFoundException,
  LimitExceededException,
  InternalException,
} from "@aws-sdk/client-eventbridge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CronName = "publish" | "metrics";

type TimeUnit = "minute" | "hour" | "day";

export type UpdateScheduleSuccess = { success: true; ruleArn: string | undefined };
export type CronActionSuccess = { success: true };
export type DescribeCronSuccess = {
  success: true;
  rule: {
    name: string | undefined;
    arn: string | undefined;
    state: string | undefined;
    scheduleExpression: string | undefined;
  };
};
export type EventBridgeNoOp = { success: false; reason: "no-rule-name" };
export type EventBridgeError = {
  success: false;
  reason: "not-found" | "rate-limited" | "internal-error";
  message: string;
};

export type UpdateScheduleResult = UpdateScheduleSuccess | EventBridgeNoOp | EventBridgeError;
export type CronActionResult = CronActionSuccess | EventBridgeNoOp | EventBridgeError;
export type DescribeCronResult = DescribeCronSuccess | EventBridgeNoOp | EventBridgeError;

// ---------------------------------------------------------------------------
// Client (lazy singleton, 3 retries)
// ---------------------------------------------------------------------------

let _client: EventBridgeClient | null = null;

function getClient(): EventBridgeClient {
  if (!_client) {
    _client = new EventBridgeClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      maxAttempts: 3,
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RULE_ENV_MAP: Record<CronName, string> = {
  publish: "PUBLISH_RULE_NAME",
  metrics: "METRICS_RULE_NAME",
};

function resolveRuleName(cronName: CronName): string | undefined {
  const envKey = RULE_ENV_MAP[cronName];
  return process.env[envKey];
}

/**
 * Build a rate expression with correct singular/plural.
 * AWS requires `rate(1 minute)` (singular) vs `rate(5 minutes)` (plural).
 */
export function buildRateExpression(value: number, unit: TimeUnit): string {
  if (value < 1 || !Number.isInteger(value)) {
    throw new Error(`Rate value must be a positive integer, got ${value}`);
  }
  const unitStr = value === 1 ? unit : `${unit}s`;
  return `rate(${value} ${unitStr})`;
}

function handleError(err: unknown): EventBridgeError {
  if (err instanceof ResourceNotFoundException) {
    return { success: false, reason: "not-found", message: err.message ?? "Resource not found" };
  }
  if (err instanceof LimitExceededException) {
    return { success: false, reason: "rate-limited", message: err.message ?? "Rate limit exceeded" };
  }
  if (err instanceof InternalException) {
    return { success: false, reason: "internal-error", message: err.message ?? "Internal error" };
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Update the schedule expression for an EventBridge rule.
 * Throws for unexpected (non-AWS) errors.
 */
export async function updateCronSchedule(
  cronName: CronName,
  expression: string
): Promise<UpdateScheduleResult> {
  const ruleName = resolveRuleName(cronName);
  if (!ruleName) return { success: false, reason: "no-rule-name" };

  try {
    const result = await getClient().send(
      new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: expression,
      })
    );
    return { success: true, ruleArn: result.RuleArn };
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Enable an EventBridge rule.
 * Throws for unexpected (non-AWS) errors.
 */
export async function enableCron(cronName: CronName): Promise<CronActionResult> {
  const ruleName = resolveRuleName(cronName);
  if (!ruleName) return { success: false, reason: "no-rule-name" };

  try {
    await getClient().send(new EnableRuleCommand({ Name: ruleName }));
    return { success: true };
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Disable an EventBridge rule.
 * Throws for unexpected (non-AWS) errors.
 */
export async function disableCron(cronName: CronName): Promise<CronActionResult> {
  const ruleName = resolveRuleName(cronName);
  if (!ruleName) return { success: false, reason: "no-rule-name" };

  try {
    await getClient().send(new DisableRuleCommand({ Name: ruleName }));
    return { success: true };
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Describe an EventBridge rule (get current state and schedule).
 * Throws for unexpected (non-AWS) errors.
 */
export async function describeCron(cronName: CronName): Promise<DescribeCronResult> {
  const ruleName = resolveRuleName(cronName);
  if (!ruleName) return { success: false, reason: "no-rule-name" };

  try {
    const result = await getClient().send(new DescribeRuleCommand({ Name: ruleName }));
    return {
      success: true,
      rule: {
        name: result.Name,
        arn: result.Arn,
        state: result.State,
        scheduleExpression: result.ScheduleExpression,
      },
    };
  } catch (err) {
    return handleError(err);
  }
}
