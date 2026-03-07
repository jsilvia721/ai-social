-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'MEMBER');

-- AlterTable: add activeBusinessId to User
ALTER TABLE "User" ADD COLUMN "activeBusinessId" TEXT;

-- CreateTable: Business
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable: BusinessMember
CREATE TABLE "BusinessMember" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ContentStrategy
CREATE TABLE "ContentStrategy" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "contentPillars" TEXT[],
    "brandVoice" TEXT NOT NULL,
    "optimizationGoal" TEXT NOT NULL,
    "reviewWindowEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reviewWindowHours" INTEGER NOT NULL DEFAULT 24,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMember_businessId_userId_key" ON "BusinessMember"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentStrategy_businessId_key" ON "ContentStrategy"("businessId");

-- AddForeignKey
ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BusinessMember" ADD CONSTRAINT "BusinessMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentStrategy" ADD CONSTRAINT "ContentStrategy_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: create one Business per existing User via temp mapping table
-- Temp table records (user_id → new business_id) for reliable cross-table reference
CREATE TEMP TABLE _user_business_map AS
SELECT
    u.id                                            AS user_id,
    gen_random_uuid()::text                         AS business_id,
    COALESCE(u.name, split_part(u.email, '@', 1))   AS business_name
FROM "User" u;

INSERT INTO "Business" ("id", "name", "createdAt", "updatedAt")
SELECT business_id, business_name, NOW(), NOW()
FROM _user_business_map;

INSERT INTO "BusinessMember" ("id", "businessId", "userId", "role", "joinedAt")
SELECT gen_random_uuid()::text, business_id, user_id, 'OWNER', NOW()
FROM _user_business_map;

DROP TABLE _user_business_map;
