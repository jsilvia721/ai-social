-- AlterTable: Post
-- Step 1: Add new columns (nullable first)
ALTER TABLE "Post"
    ADD COLUMN "businessId"            TEXT,
    ADD COLUMN "retryCount"            INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "retryAt"               TIMESTAMP(3),
    ADD COLUMN "reviewWindowExpiresAt" TIMESTAMP(3);

-- Step 2: Rename platformPostId → blotatoPostId
ALTER TABLE "Post" RENAME COLUMN "platformPostId" TO "blotatoPostId";

-- Step 3: Backfill businessId from SocialAccount.businessId (via socialAccountId)
-- SocialAccount already has businessId set from the previous migration
UPDATE "Post" p
SET "businessId" = sa."businessId"
FROM "SocialAccount" sa
WHERE sa.id = p."socialAccountId";

-- Step 4: Guard — delete orphaned posts (no socialAccount = no businessId)
DELETE FROM "Post" WHERE "businessId" IS NULL;
ALTER TABLE "Post" ALTER COLUMN "businessId" SET NOT NULL;

-- Step 5: Add FK for businessId
ALTER TABLE "Post" ADD CONSTRAINT "Post_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 6: Remove old userId FK and column
ALTER TABLE "Post" DROP CONSTRAINT IF EXISTS "Post_userId_fkey";
ALTER TABLE "Post" DROP COLUMN "userId";

-- Step 7: Drop old userId-prefixed indexes (replaced by new composite indexes below)
DROP INDEX IF EXISTS "Post_userId_status_scheduledAt_idx";
DROP INDEX IF EXISTS "Post_userId_scheduledAt_idx";

-- Step 8: Add new indexes optimized for scheduler queries (no userId prefix)
CREATE INDEX "Post_status_scheduledAt_idx" ON "Post"("status", "scheduledAt");
CREATE INDEX "Post_status_retryAt_idx" ON "Post"("status", "retryAt");
CREATE INDEX "Post_status_metricsUpdatedAt_idx" ON "Post"("status", "metricsUpdatedAt");
