---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, database, migration, deployment]
dependencies: []
---

# P1 — `platformPostId` Column Rename Scheduled in Wrong Release — Crashes Release 1 Lambda

## Problem Statement

The plan places `RENAME COLUMN "platformPostId" TO "blotatoPostId"` in Release 1 migration (`20260308_update_post`). But Release 1 still runs the **current** Lambda code (`src/lib/scheduler.ts`) which writes to `platformPostId`. After the Release 1 migration executes on Neon, the column no longer exists by the old name — every publish attempt will crash with a column-not-found error until SST finishes deploying Release 2 code.

This window (migration complete → new Lambda deployed) typically takes 2-5 minutes during `sst deploy`, but is enough to corrupt every in-flight post.

## Findings

- Source: data-migration-expert (Finding 6)
- The three-release strategy is designed to eliminate exactly this kind of deploy-window breakage — the column rename violates its own safety guarantee
- Architecture review independently flagged this as a risk to the three-release sequencing

## Proposed Solutions

### Option A — Add `blotatoPostId` as a new column in Release 1; keep `platformPostId`; drop in Release 3 (Recommended)

**Release 1 migration:** Add `blotatoPostId String?` as a new nullable column. Keep `platformPostId` (existing Release 1 code still writes it).

**Release 2 code:** Write to `blotatoPostId`. Stop writing `platformPostId`. Dual-write both during transition if needed.

**Release 3 migration:** Drop `platformPostId`.

```sql
-- Release 1 migration (add column only, do NOT rename):
ALTER TABLE "Post" ADD COLUMN "blotatoPostId" TEXT;
```

**Pros:** No deploy-window crash. Follows the three-release strategy correctly.
**Cons:** Both columns exist simultaneously during Release 2. Minor schema noise.
**Effort:** Small | **Risk:** Low

### Option B — Move the rename to Release 3 only
Rename `platformPostId` → `blotatoPostId` in the Release 3 migration, after Release 2 code is stable.

**Pros:** Simpler — one column, one rename.
**Cons:** Still has a micro-window issue (rename happens, then code deploys). Safer than Release 1 but still risky.
**Effort:** Small | **Risk:** Low-Medium

## Recommended Action

Option A — add `blotatoPostId` as a new nullable column in Release 1. Release 2 code writes it. Release 3 drops `platformPostId`. Aligns with the plan's three-release safety philosophy.

## Technical Details

- **Affected files:** `prisma/migrations/20260308_update_post/migration.sql`, `prisma/schema.prisma`, Phase 1 migration plan
- **Plan phase:** Phase 1

## Acceptance Criteria

- [ ] Release 1 migration adds `blotatoPostId String?` — does NOT rename `platformPostId`
- [ ] Release 2 scheduler code writes to `blotatoPostId`
- [ ] Release 3 migration drops `platformPostId`
- [ ] Phase 1 migration plan updated to reflect three-release column addition strategy (not rename)

## Work Log

- 2026-03-07: Identified by data-migration-expert (Finding 6) during plan review
