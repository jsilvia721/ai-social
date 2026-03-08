---
status: pending
priority: p3
issue_id: "017"
tags: [code-review, scope, yagni]
dependencies: []
---

# P3 — Cut Review Window from M1 — Scope Creep, Not in Exit Criteria

## Problem Statement

The M1 exit criteria is: "Partner can manage 3+ client workspaces, each with multiple platform accounts connected via Blotato, and schedule/publish posts manually to all platforms."

Manual scheduling does not require a review window. The review window is an approval workflow layer that adds substantial complexity not needed to meet the exit criteria:

- `reviewWindowEnabled`, `reviewWindowHours` fields on `ContentStrategy`
- `reviewWindowExpiresAt` column on `Post`
- `PENDING_REVIEW` PostStatus enum value
- `/dashboard/[businessId]/review/page.tsx` (a full page)
- `ReviewCountdown` component
- Approve/reject logic in `PATCH /api/posts/[id]`
- Auto-expiry logic in the scheduler

Roughly 150-200 lines of production code + tests for a feature not in the M1 exit criteria.

## Findings

- Source: code-simplicity-reviewer (Finding 7)
- This is the same reason `GenerationModule` and `WorkspaceModuleConfig` were cut — they add complexity before the core flow works
- Note: `PUBLISHING` intermediate status is still needed for the scheduler's double-publish prevention — keep that. Only the review window's use of it (in the approve route) goes away.
- Cutting this also eliminates the approve-route complexity flagged in todo-012

## Proposed Solutions

### Cut from M1 (Recommended)
Remove from M1 scope:
- `reviewWindowEnabled`, `reviewWindowHours` from `ContentStrategy` schema
- `reviewWindowExpiresAt` from `Post` schema
- `PENDING_REVIEW` from PostStatus enum
- `/dashboard/[businessId]/review/page.tsx`
- `ReviewCountdown` component
- Approve/reject logic from `PATCH /api/posts/[id]`
- Auto-expiry logic from scheduler

**Keep in M1:** `PUBLISHING` status (scheduler double-publish lock), `RETRYING` status, retry machinery.

Add to M2 backlog: Review window with approval workflow.

**Effort:** Negative (removes code) | **Risk:** Low

## Recommended Action

Update the plan to remove review window from M1 scope. Add a note in the M1 phase table marking it as M2.

## Technical Details

- **Affected files:** `prisma/schema.prisma`, `src/lib/scheduler.ts`, `src/app/api/posts/[id]/route.ts`, plan document
- **Plan phase:** All phases

## Acceptance Criteria

- [ ] `reviewWindowEnabled`, `reviewWindowHours` removed from `ContentStrategy` schema in M1
- [ ] `reviewWindowExpiresAt` removed from `Post` schema in M1
- [ ] `PENDING_REVIEW` removed from PostStatus enum in M1 migration
- [ ] Review page and ReviewCountdown component removed from M1 new files list
- [ ] Plan document updated with scope cut note pointing to M2

## Work Log

- 2026-03-07: Identified by code-simplicity-reviewer (Finding 7) during plan review
