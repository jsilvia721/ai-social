/**
 * Post-deploy sync script: re-applies CronConfig overrides to EventBridge.
 *
 * After every `sst deploy`, EventBridge rules reset to sst.config.ts values.
 * This script reads CronConfig from the database and re-applies any
 * non-default schedules or disabled states.
 *
 * Usage: npx tsx scripts/sync-cron-config.ts
 *
 * Exit codes:
 *   0 — success (including no-op)
 *   1 — one or more sync actions failed
 */

import { prisma } from "@/lib/db";
import {
  updateCronSchedule,
  disableCron,
  RULE_ENV_MAP,
  type CronName,
} from "@/lib/eventbridge";

// ---------------------------------------------------------------------------
// Default schedule expressions from sst.config.ts
// Used to detect which configs have been customized.
// ---------------------------------------------------------------------------

const DEFAULT_SCHEDULES: Record<CronName, string> = {
  publish: "rate(1 minute)",
  metrics: "rate(60 minutes)",
  research: "cron(0 */4 * * ? *)",
  briefs: "cron(0 23 ? * SUN *)",
  fulfill: "rate(6 hours)",
  optimize: "cron(0 2 ? * SUN *)",
  brainstorm: "rate(60 minutes)",
};

// ---------------------------------------------------------------------------
// Core sync logic (exported for testing)
// ---------------------------------------------------------------------------

export interface SyncResult {
  total: number;
  synced: number;
  skipped: number;
  errors: number;
  actions: string[];
}

export async function syncCronConfig(): Promise<SyncResult> {
  const configs = await prisma.cronConfig.findMany();

  const result: SyncResult = {
    total: configs.length,
    synced: 0,
    skipped: 0,
    errors: 0,
    actions: [],
  };

  if (configs.length === 0) {
    console.log("[sync-cron-config] No CronConfig rows found — nothing to sync.");
    return result;
  }

  for (const config of configs) {
    const cronName = config.cronName as CronName;
    const defaultSchedule = DEFAULT_SCHEDULES[cronName];
    const hasCustomSchedule =
      defaultSchedule !== undefined &&
      config.scheduleExpression !== defaultSchedule;
    const isDisabled = !config.enabled;

    // Skip if config matches defaults (enabled + default schedule)
    if (!hasCustomSchedule && !isDisabled) {
      continue;
    }

    // Check if we have the rule name env var
    const envKey = RULE_ENV_MAP[cronName];
    if (!envKey || !process.env[envKey]) {
      console.warn(
        `[sync-cron-config] Skipping "${cronName}" — no rule name env var (${envKey})`
      );
      result.skipped++;
      continue;
    }

    try {
      // Re-apply custom schedule if it differs from default
      if (hasCustomSchedule) {
        const scheduleResult = await updateCronSchedule(
          cronName,
          config.scheduleExpression
        );
        if (scheduleResult.success) {
          result.actions.push(
            `Updated schedule for "${cronName}" to "${config.scheduleExpression}"`
          );
        } else {
          throw new Error(
            `Failed to update schedule: ${JSON.stringify(scheduleResult)}`
          );
        }
      }

      // Disable the rule if it's disabled in CronConfig
      if (isDisabled) {
        const disableResult = await disableCron(cronName);
        if (disableResult.success) {
          result.actions.push(`Disabled "${cronName}"`);
        } else {
          throw new Error(
            `Failed to disable: ${JSON.stringify(disableResult)}`
          );
        }
      }

      // Update syncStatus to SYNCED
      await prisma.cronConfig.update({
        where: { cronName },
        data: { syncStatus: "SYNCED" },
      });

      result.synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[sync-cron-config] Error syncing "${cronName}": ${message}`);
      result.errors++;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main (CLI entry point)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("[sync-cron-config] Starting post-deploy cron config sync...");

  try {
    const result = await syncCronConfig();

    for (const action of result.actions) {
      console.log(`[sync-cron-config] ✓ ${action}`);
    }

    console.log(
      `[sync-cron-config] Done. Total: ${result.total}, Synced: ${result.synced}, Skipped: ${result.skipped}, Errors: ${result.errors}`
    );

    if (result.errors > 0) {
      process.exit(1);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sync-cron-config] Fatal error: ${message}`);
    process.exit(1);
  }
}

// Only run main when executed directly (not imported in tests)
if (require.main === module) {
  main();
}
