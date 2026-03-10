-- CreateEnum
CREATE TYPE "BriefFormat" AS ENUM ('TEXT', 'IMAGE', 'CAROUSEL', 'VIDEO');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('PENDING', 'FULFILLED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ContentStrategy" ADD COLUMN     "postingCadence" JSONB,
ADD COLUMN     "researchSources" JSONB;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "briefId" TEXT;

-- CreateTable
CREATE TABLE "ResearchSummary" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "sourceItems" JSONB NOT NULL,
    "synthesizedThemes" TEXT NOT NULL,
    "sourcesUsed" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearchSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBrief" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "researchSummaryId" TEXT,
    "topic" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "suggestedCaption" TEXT NOT NULL,
    "aiImagePrompt" TEXT,
    "contentGuidance" TEXT,
    "recommendedFormat" "BriefFormat" NOT NULL,
    "platform" "Platform" NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "BriefStatus" NOT NULL DEFAULT 'PENDING',
    "weekOf" TIMESTAMP(3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "postId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearchSummary_businessId_createdAt_idx" ON "ResearchSummary"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentBrief_postId_key" ON "ContentBrief"("postId");

-- CreateIndex
CREATE INDEX "ContentBrief_businessId_status_idx" ON "ContentBrief"("businessId", "status");

-- CreateIndex
CREATE INDEX "ContentBrief_status_weekOf_idx" ON "ContentBrief"("status", "weekOf");

-- AddForeignKey
ALTER TABLE "ResearchSummary" ADD CONSTRAINT "ResearchSummary_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBrief" ADD CONSTRAINT "ContentBrief_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
