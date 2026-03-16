---
title: "feat: Manual cron job triggers in admin UI"
type: feat
status: active
date: 2026-03-15
---

# Manual Cron Job Triggers in Admin UI

## Context

The app has 7 cron jobs running on EventBridge schedules (publish, metrics, research, briefs, fulfill, optimize, brainstorm). The admin System page already has a `CronScheduleManager` component for viewing/editing schedules and enabling/disabling jobs, but there's no way to manually trigger a run from the UI. This forces waiting for the next scheduled execution when testing or when a run is needed immediately (e.g., generating briefs mid-week).

## Approach

Add a "Run Now" button to each cron card in the existing `CronScheduleManager`, backed by a single new API route that dispatches to the appropriate handler. Manual runs are tracked in `CronRun` with `triggerSource: "manual"` metadata. Jobs execute asynchronously (fire-and-forget) so the API responds immediately — avoids Next.js route timeouts for long-running jobs like fulfill/optimize.

## Implementation

### Step 1: Tests for trigger API route (TDD)

**Create:** `src/__tests__/api/system/cron-trigger.test.ts`

Follow the pattern in `src/__tests__/api/system/cron-config.test.ts`:
- Mock `@/lib/db`, `next-auth/next`, `@/lib/auth`, and all 7 handler modules
- Test cases:
  - 401 for unauthenticated requests
  - 403 for non-admin users
  - 400 for invalid/missing `cronName`
  - 200 + correct handler called for each valid cron name
  - Creates `CronRun` with `metadata.triggerSource === "manual"` and `status: "RUNNING"`
  - Returns `{ success: true, cronName }` in response

### Step 2: Create trigger API route

**Create:** `src/app/api/system/cron/trigger/route.ts`

- `requireAdmin()` gate (from `src/lib/system/shared.ts`)
- Zod validation: `{ cronName: z.enum([...all 7 names]) }`
- Handler lookup map:
  | cronName | Function | Module |
  |----------|----------|--------|
  | publish | `runScheduler()` | `@/lib/scheduler` |
  | metrics | `runMetricsRefresh()` | `@/lib/scheduler` |
  | research | `runResearchPipeline()` | `@/lib/research` |
  | briefs | `runBriefGeneration()` | `@/lib/briefs` |
  | fulfill | `runFulfillment()` | `@/lib/fulfillment` |
  | optimize | `runWeeklyOptimization()` | `@/lib/optimizer/run` |
  | brainstorm | `runBrainstormAgent()` | `@/lib/brainstorm/run` |

- Fire-and-forget pattern:
  1. Record `CronRun` with `status: "RUNNING"`, `metadata: { triggerSource: "manual" }`
  2. Start handler in detached `void (async () => { ... })()` — updates CronRun to SUCCESS/FAILED on completion
  3. Return `{ success: true, cronName }` immediately
- Bypass `checkCronEnabled()` — admin is explicitly requesting the run

### Step 3: Add "Run Now" button to CronCard

**Modify:** `src/components/system/CronScheduleManager.tsx`

Changes to `CronCard`:
- Add `onTrigger` prop: `(cronName: CronName) => Promise<{ success: boolean; error?: string }>`
- Add local state: `triggering: boolean`, `triggerResult: { type: "success" | "error"; message: string } | null`
- Add "Run Now" button in the header row alongside sync badge and toggle — use `Play` icon from lucide-react
- Show inline result feedback below the schedule line (auto-clear after 5s)
- For `publish` cron: show confirmation via `ConfirmDialog` before triggering

Changes to `ConfirmDialog`:
- Make confirm button text and color configurable via props (`confirmLabel`, `confirmClassName`)
- Default remains red "Disable" for backward compat; trigger confirmation uses violet "Run Now"

Changes to `CronScheduleManager`:
- Add `handleTrigger` function that POSTs to `/api/system/cron/trigger`
- Pass `onTrigger={handleTrigger}` to each `CronCard`
- Add separate `triggerConfirmDialog` state for the publish trigger confirmation (keep existing `confirmDialog` for disable)

## Key Files

| File | Action |
|------|--------|
| `src/__tests__/api/system/cron-trigger.test.ts` | Create |
| `src/app/api/system/cron/trigger/route.ts` | Create |
| `src/components/system/CronScheduleManager.tsx` | Modify |

## Reuse

- `requireAdmin()` from `src/lib/system/shared.ts` — admin gate
- `trackCronRun()` from `src/lib/system-metrics.ts` — fire-and-forget run tracking (for the completion update; initial RUNNING entry uses prisma directly to get the ID back)
- `CronName` type from `src/lib/system-metrics.ts`
- `ConfirmDialog` already in CronScheduleManager — extend with configurable confirm label
- All 7 handler functions already accept no-arg calls

## No Schema Changes

`CronRun.metadata` is already `Json?` — storing `{ triggerSource: "manual" }` requires no migration.

## Verification

1. `npx jest src/__tests__/api/system/cron-trigger.test.ts` — API route tests pass
2. `npm run ci:check` — lint + typecheck + coverage pass
3. Manual: navigate to `/dashboard/system`, click "Run Now" on any cron card, verify:
   - Button shows loading spinner
   - Success message appears briefly
   - Cron run history (`/api/system/cron-runs`) shows the manual run with `triggerSource: "manual"` metadata
4. Manual: click "Run Now" on publish — confirm dialog appears first
