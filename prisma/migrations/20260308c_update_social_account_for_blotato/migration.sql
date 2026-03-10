-- AlterTable: SocialAccount
-- Step 1: Add new columns (nullable first for safe backfill)
ALTER TABLE "SocialAccount"
    ADD COLUMN "businessId"       TEXT,
    ADD COLUMN "blotatoAccountId" TEXT,
    ALTER COLUMN "accessToken"    DROP NOT NULL;

-- Step 2: Backfill businessId from BusinessMember (OWNER link via userId)
UPDATE "SocialAccount" sa
SET "businessId" = bm."businessId"
FROM "BusinessMember" bm
WHERE bm."userId" = sa."userId"
  AND bm."role" = 'OWNER';

-- Step 3: Guard — any SocialAccount without an owner business gets the first business from any membership
UPDATE "SocialAccount" sa
SET "businessId" = (
    SELECT bm2."businessId"
    FROM "BusinessMember" bm2
    WHERE bm2."userId" = sa."userId"
    ORDER BY bm2."joinedAt"
    LIMIT 1
)
WHERE sa."businessId" IS NULL
  AND sa."userId" IS NOT NULL;

-- Step 4: Enforce NOT NULL now that backfill is complete
-- (Any SocialAccount without a userId or business is orphaned — safe to delete)
DELETE FROM "SocialAccount" WHERE "businessId" IS NULL;
ALTER TABLE "SocialAccount" ALTER COLUMN "businessId" SET NOT NULL;

-- Step 5: Set placeholder for blotatoAccountId (cannot be empty — will be populated via connect flow)
-- Use empty string as placeholder; real values set when user reconnects via Blotato
UPDATE "SocialAccount" SET "blotatoAccountId" = '' WHERE "blotatoAccountId" IS NULL;
ALTER TABLE "SocialAccount" ALTER COLUMN "blotatoAccountId" SET NOT NULL;

-- Step 6: Add FK and remove old userId FK
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SocialAccount" DROP CONSTRAINT IF EXISTS "SocialAccount_userId_fkey";
ALTER TABLE "SocialAccount" DROP COLUMN "userId";
