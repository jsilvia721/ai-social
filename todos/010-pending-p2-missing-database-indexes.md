---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, performance, database, indexes]
dependencies: ["006"]
---

# P2 — Missing Database Indexes on New Models

## Problem Statement

The plan adds three Post indexes but is missing several indexes that will cause sequential scans on every auth check, accounts list, and stuck-post recovery query. These must be added in the Phase 1 migration, not retrofitted later — adding indexes post-launch on a growing table requires `CREATE INDEX CONCURRENTLY` on Neon.

## Findings

- Source: performance-oracle (Findings 3, 4), data-migration-expert (Finding 5)

**Missing indexes:**
1. `BusinessMember(userId, role)` — session callback and `assertBusinessMember` both query by `userId`. The `@@unique([businessId, userId])` index leads with `businessId`, not `userId` — doesn't cover `findFirst({ where: { userId, role: "OWNER" } })`
2. `BusinessMember(userId)` — plain member lookups without role filter
3. `SocialAccount(businessId)` — Postgres does not auto-create FK indexes; accounts list query `findMany({ where: { businessId } })` does a sequential scan
4. `ContentStrategy(businessId)` — `findUnique({ where: { businessId } })` uses the unique constraint, but any future `findMany` would scan
5. `Post(status, updatedAt)` — stuck-post recovery query `{ status: "PUBLISHING", updatedAt: { lt: ... } }` has no covering index
6. All new indexes must use `CREATE INDEX CONCURRENTLY` — Prisma generates blocking `CREATE INDEX` by default

## Proposed Solutions

### Add to Phase 1 migration schema (and use CONCURRENTLY in SQL)

**`prisma/schema.prisma`:**
```prisma
model BusinessMember {
  @@index([userId, role])
  @@index([userId])
  // existing: @@unique([businessId, userId])
}

model SocialAccount {
  @@index([businessId])
  // existing: @@unique([platform, platformId])
  // existing: @@unique([blotatoAccountId])  ← from todo-002
}

model Post {
  // existing from plan:
  @@index([status, scheduledAt])
  @@index([status, retryAt])
  @@index([status, metricsUpdatedAt])
  // NEW — stuck-post recovery:
  @@index([status, updatedAt])
}
```

**Migration SQL (use `--create-only` and manually write CONCURRENTLY):**
```sql
-- In a migration file with transactional = false (CONCURRENTLY requires non-transactional):
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BusinessMember_userId_role_idx"
  ON "BusinessMember"("userId", role);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "BusinessMember_userId_idx"
  ON "BusinessMember"("userId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "SocialAccount_businessId_idx"
  ON "SocialAccount"("businessId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_status_updatedAt_idx"
  ON "Post"(status, "updatedAt");
```

The plan's three Post indexes also need `CONCURRENTLY`. Create a dedicated migration file for all indexes with `transactional = false`.

**Effort:** Small | **Risk:** Low

## Recommended Action

Add all missing indexes to Phase 1 migration. Create a separate index migration file with `transactional = false` and use `CREATE INDEX CONCURRENTLY` for all indexes on existing tables.

## Technical Details

- **Affected files:** `prisma/schema.prisma`, Phase 1 migration SQL files
- **Plan phase:** Phase 1

## Acceptance Criteria

- [ ] `BusinessMember` has `@@index([userId, role])` and `@@index([userId])`
- [ ] `SocialAccount` has `@@index([businessId])`
- [ ] `Post` has `@@index([status, updatedAt])` in addition to the three existing planned indexes
- [ ] All indexes on existing tables use `CREATE INDEX CONCURRENTLY` in migration SQL
- [ ] Index migration file has `transactional = false` in `migration.toml`

## Work Log

- 2026-03-07: Identified by performance-oracle (Findings 3, 4) and data-migration-expert (Finding 5) during plan review
