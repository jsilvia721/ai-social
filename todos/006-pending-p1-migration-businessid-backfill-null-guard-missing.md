---
status: complete
priority: p1
issue_id: "006"
tags: [code-review, database, migration, data-integrity]
dependencies: ["005"]
---

# P1 — `businessId` Backfill Has No NULL Guard; `SocialAccount` Backfill SQL Missing

## Problem Statement

The plan's `businessId` backfill on `Post` runs a correlated subquery then immediately calls `SET NOT NULL`. If any `Post` row has no matching `BusinessMember.OWNER` (e.g., a user with no business created yet, or if the Business INSERT ran after the Post UPDATE due to migration ordering), the subquery returns NULL and `SET NOT NULL` throws a constraint violation — aborting the migration and leaving the database half-migrated on Neon.

Additionally, the `SocialAccount.businessId` backfill SQL is completely absent from the plan. `SocialAccount` also gets a `businessId FK` column but no migration SQL is provided for it.

## Findings

- Source: data-migration-expert (Finding 2), architecture-strategist (Finding 2)
- Neon does not support rolling back DDL in the same way as traditional transactional migrations
- The Business backfill uses `gen_random_uuid()` without preserving the User→Business UUID mapping, so the subsequent `BusinessMember` INSERT SQL is missing — without it, the junction table is empty and the Post backfill subquery returns NULL for every post
- Architecture review: Business INSERT and Post.businessId UPDATE must be in the same migration file to guarantee atomicity via migration ordering

## Proposed Solutions

### Option A — Use deterministic UUIDs + CTE + NULL assertion guard (Recommended)

```sql
-- 1. Create one Business per User using deterministic ID
INSERT INTO "Business" (id, name, "createdAt", "updatedAt")
SELECT
  md5(u.id)::uuid::text,
  COALESCE(u.name, split_part(u.email, '@', 1)),
  NOW(), NOW()
FROM "User" u
ON CONFLICT DO NOTHING;

-- 2. Create BusinessMember OWNER for each User
INSERT INTO "BusinessMember" (id, "businessId", "userId", role, "joinedAt")
SELECT
  gen_random_uuid()::text,
  md5(u.id)::uuid::text,
  u.id,
  'OWNER',
  NOW()
FROM "User" u
ON CONFLICT ("businessId", "userId") DO NOTHING;

-- 3. Backfill Post.businessId
UPDATE "Post" p SET "businessId" = md5(u.id)::uuid::text
FROM "User" u WHERE u.id = p."userId";

-- 4. NULL guard — abort if any rows missed
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Post" WHERE "businessId" IS NULL) THEN
    RAISE EXCEPTION 'Post businessId backfill incomplete — % rows have NULL',
      (SELECT COUNT(*) FROM "Post" WHERE "businessId" IS NULL);
  END IF;
END $$;

ALTER TABLE "Post" ALTER COLUMN "businessId" SET NOT NULL;

-- 5. Backfill SocialAccount.businessId
UPDATE "SocialAccount" sa SET "businessId" = md5(u.id)::uuid::text
FROM "User" u WHERE u.id = sa."userId";

-- 6. NULL guard for SocialAccount
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SocialAccount" WHERE "businessId" IS NULL) THEN
    RAISE EXCEPTION 'SocialAccount businessId backfill incomplete — % rows have NULL',
      (SELECT COUNT(*) FROM "SocialAccount" WHERE "businessId" IS NULL);
  END IF;
END $$;

ALTER TABLE "SocialAccount" ALTER COLUMN "businessId" SET NOT NULL;
```

Using `md5(userId)::uuid` makes the migration idempotent (safe to re-run) and eliminates the Business→User pairing problem with non-correlated random UUIDs.

**Pros:** Deterministic. Idempotent. Fails loudly if backfill is incomplete.
**Cons:** `md5` for UUID generation is non-standard but safe for internal IDs.
**Effort:** Medium | **Risk:** Low (with guards)

## Recommended Action

Option A — use deterministic IDs, write the missing `SocialAccount` backfill SQL, add NULL guards before every `SET NOT NULL` call.

## Technical Details

- **Affected files:** `prisma/migrations/20260308_add_business_member/migration.sql`, `prisma/migrations/20260308_update_social_account/migration.sql`, `prisma/migrations/20260308_update_post/migration.sql`
- **Plan phase:** Phase 1

## Acceptance Criteria

- [ ] Business INSERT uses deterministic ID (`md5(userId)::uuid::text`) — idempotent
- [ ] `BusinessMember` INSERT SQL included and correct
- [ ] `SocialAccount.businessId` backfill SQL written (was missing from plan)
- [ ] NULL guard (`DO $$ ... RAISE EXCEPTION`) before every `SET NOT NULL` call
- [ ] Business and Post backfill in same migration file to guarantee ordering
- [ ] Post-migration verification queries documented and run before Release 2

## Work Log

- 2026-03-07: Identified by data-migration-expert (Finding 2, 7) and architecture-strategist (Finding 2) during plan review
