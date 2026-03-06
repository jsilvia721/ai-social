---
status: pending
priority: p2
issue_id: "012"
tags: [code-review, performance, database, prisma]
dependencies: []
---

# Missing database indexes on posts and social accounts tables

## Problem Statement

The posts table is queried frequently by `userId`, `status`, and `scheduledAt` (scheduler runs every minute). Without indexes, these queries do full table scans. At scale (thousands of posts), the scheduler and API will degrade significantly.

## Findings

- Scheduler queries: `WHERE userId = ? AND status = 'SCHEDULED' AND scheduledAt <= NOW()`
- Calendar endpoint queries: `WHERE userId = ? AND scheduledAt BETWEEN ? AND ?`
- No composite indexes on these common query patterns
- Confirmed by: Performance Oracle

## Proposed Solutions

### Option A: Add Prisma `@@index` directives (Recommended)
```prisma
model Post {
  @@index([userId, status, scheduledAt])
  @@index([userId, scheduledAt])
}
```
- Run `npx prisma migrate dev --name add_post_indexes`
- Effort: Small | Risk: None

## Recommended Action

Option A.

## Technical Details

- **Affected files:** `prisma/schema.prisma`
- Requires a migration

## Acceptance Criteria

- [ ] Composite index on `(userId, status, scheduledAt)` for scheduler queries
- [ ] Composite index on `(userId, scheduledAt)` for calendar queries
- [ ] Migration generated and applied to staging

## Work Log

- 2026-03-06: Identified by Performance Oracle. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
