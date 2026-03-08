-- AlterTable: Add Milestone 3 columns to Post
ALTER TABLE "Post" ADD COLUMN     "topicPillar" TEXT,
ADD COLUMN     "tone" TEXT;

-- AlterTable: Add Milestone 3 columns to ContentStrategy
ALTER TABLE "ContentStrategy" ADD COLUMN     "formatMix" JSONB,
ADD COLUMN     "optimalTimeWindows" JSONB,
ADD COLUMN     "lastOptimizedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StrategyDigest" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "patterns" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StrategyDigest_businessId_weekOf_key" ON "StrategyDigest"("businessId", "weekOf");

-- CreateIndex
CREATE INDEX "StrategyDigest_businessId_createdAt_idx" ON "StrategyDigest"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "StrategyDigest" ADD CONSTRAINT "StrategyDigest_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
