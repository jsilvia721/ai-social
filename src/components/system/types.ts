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
