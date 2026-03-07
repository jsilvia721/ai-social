export async function register() {
  // Scheduling is managed by AWS EventBridge (src/cron/publish.ts, src/cron/metrics.ts).
  // No in-process scheduler needed.
}
