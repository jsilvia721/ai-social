export interface ApiBucket {
  timestamp: string;
  service: string;
  count: number;
  avgLatencyMs: number;
  errorCount: number;
}

export interface CronStatusInfo {
  cronName: string;
  lastRunAt: string | null;
  successRate: number;
  enabled: boolean;
}

export interface CronRunRow {
  id: string;
  cronName: string;
  status: "SUCCESS" | "FAILED" | "RUNNING";
  itemsProcessed: number | null;
  durationMs: number | null;
  startedAt: string;
}

export interface ErrorBucket {
  timestamp: string;
  source: string;
  count: number;
  errorCount: number;
}

export interface TopError {
  message: string;
  count: number;
  lastSeenAt: string;
  status: "NEW" | "ISSUE_CREATED" | "RESOLVED" | "IGNORED";
  source: string;
}

// --- Cron Config types (from GET /api/system/cron-config) ---

export type CronName =
  | "publish"
  | "metrics"
  | "research"
  | "briefs"
  | "fulfill"
  | "optimize"
  | "brainstorm";

export type ScheduleType = "rate" | "cron";
export type SyncStatus = "SYNCED" | "PENDING";
export type IntervalUnit = "minutes" | "hours";
export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface CronConfigItem {
  id: string;
  cronName: CronName;
  scheduleExpression: string;
  scheduleType: ScheduleType;
  enabled: boolean;
  intervalValue: number | null;
  intervalUnit: IntervalUnit | null;
  dayOfWeek: DayOfWeek | null;
  hourUtc: number | null;
  syncStatus: SyncStatus;
  updatedAt: string;
  lastRunAt: string | null;
  lastStatus: "SUCCESS" | "FAILED" | "RUNNING" | null;
}

export const CRON_DESCRIPTIONS: Record<CronName, { label: string; description: string }> = {
  publish: { label: "Publisher", description: "Publishes scheduled posts when due" },
  metrics: { label: "Metrics", description: "Refreshes engagement metrics for published posts" },
  research: { label: "Research", description: "Gathers content research and trends" },
  briefs: { label: "Briefs", description: "Generates content briefs from strategy" },
  fulfill: { label: "Fulfillment", description: "Creates draft posts from approved briefs" },
  optimize: { label: "Optimizer", description: "Weekly strategy performance review" },
  brainstorm: { label: "Brainstorm", description: "Generates new content ideas" },
};

export const RATE_CRON_NAMES = new Set<CronName>([
  "publish", "metrics", "research", "briefs", "fulfill", "brainstorm",
]);

export const WEEKLY_CRON_NAMES = new Set<CronName>(["optimize"]);

/** Safety rails: min/max interval in minutes per rate cron */
export const INTERVAL_LIMITS: Partial<Record<CronName, { min: number; max: number }>> = {
  publish: { min: 1, max: 10 },
  metrics: { min: 15, max: 600 },
  research: { min: 60, max: 2880 },
  fulfill: { min: 60, max: 2880 },
  brainstorm: { min: 30, max: 1440 },
  briefs: { min: 60, max: 2880 },
};
