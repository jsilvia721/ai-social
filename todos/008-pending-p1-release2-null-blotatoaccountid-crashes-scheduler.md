---
status: complete
priority: p1
issue_id: "008"
tags: [code-review, database, migration, scheduler, deployment]
dependencies: ["005", "006"]
---

# P1 — Release 2 Scheduler Passes NULL `blotatoAccountId` to Blotato API

## Problem Statement

In the three-release strategy, `blotatoAccountId` is added as nullable in Release 1. In Release 2, the new scheduler code reads `post.socialAccount.blotatoAccountId` and passes it to `publishPost()`. Any `SocialAccount` that hasn't been reconnected via Blotato will have `blotatoAccountId = NULL`. The scheduler will pass `null` to `blotatoFetch()`, Blotato will return a 4xx (non-429), `shouldRetry()` will return `false`, and every post tied to un-migrated accounts will be permanently `FAILED` in a single scheduler invocation.

## Findings

- Source: data-migration-expert (Finding 1), architecture-strategist (Finding 12)
- The plan does not include a null guard in the Release 2 scheduler query
- For a 2-person team, all existing accounts need to be reconnected via Blotato before Release 2 — but the plan has no pre-deployment checklist enforcing this
- Architecture review recommends surfacing this as a graceful `FAILED` with a clear message, not a cryptic API error

## Proposed Solutions

### Option A — Add null guard in scheduler query (Recommended)
```typescript
const duePosts = await prisma.post.findMany({
  where: {
    status: { in: ["SCHEDULED", "RETRYING"] },
    scheduledAt: { lte: now },
    socialAccount: {
      blotatoAccountId: { not: null },  // skip un-migrated accounts
    },
  },
  include: { socialAccount: true },
});
```

Plus a graceful failure path in `publishOne()`:
```typescript
if (!post.socialAccount.blotatoAccountId) {
  await prisma.post.update({
    where: { id: post.id },
    data: {
      status: "FAILED",
      errorMessage: "Account not connected to Blotato — please reconnect in Accounts settings",
    },
  });
  return;
}
```

**Pros:** Graceful. Clear error message in UI. No cryptic crash.
**Cons:** Posts with un-migrated accounts silently skip — partner must notice and reconnect.
**Effort:** Small | **Risk:** Low

### Option B — Pre-deployment gate in CI
Add a SQL pre-check that blocks Release 2 deploy if any `SocialAccount` has null `blotatoAccountId`:
```sql
-- Must return 0 before Release 2 deploys:
SELECT COUNT(*) FROM "SocialAccount" WHERE "blotatoAccountId" IS NULL;
```

**Pros:** Prevents the issue entirely.
**Cons:** Requires all accounts to be reconnected before deploy — inflexible for partial migrations.
**Effort:** Small | **Risk:** Low

## Recommended Action

Both options: Option A for graceful runtime handling, plus a deployment checklist note (Option B) documented in the plan's Release 2 section.

## Technical Details

- **Affected files:** `src/lib/scheduler.ts` (Release 2 version)
- **Plan phase:** Phase 8, Release 2 deployment section

## Acceptance Criteria

- [ ] Scheduler query filters out posts where `socialAccount.blotatoAccountId IS NULL`
- [ ] `publishOne()` has a null guard that sets `FAILED` with a clear user-facing message
- [ ] Deployment checklist includes pre-check SQL for null `blotatoAccountId` count
- [ ] Test: scheduler skips posts with null `blotatoAccountId` without crashing

## Work Log

- 2026-03-07: Identified by data-migration-expert (Finding 1) and architecture-strategist (Finding 12) during plan review
