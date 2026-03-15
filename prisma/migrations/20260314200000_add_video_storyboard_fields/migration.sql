-- AlterEnum
ALTER TYPE "BriefStatus" ADD VALUE 'STORYBOARD_REVIEW' BEFORE 'FULFILLED';
ALTER TYPE "BriefStatus" ADD VALUE 'RENDERING' BEFORE 'FULFILLED';

-- AlterTable
ALTER TABLE "ContentBrief" ADD COLUMN     "replicatePredictionId" TEXT,
ADD COLUMN     "storyboardImageUrl" TEXT,
ADD COLUMN     "videoAspectRatio" TEXT,
ADD COLUMN     "videoModel" TEXT,
ADD COLUMN     "videoPrompt" TEXT,
ADD COLUMN     "videoScript" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ContentBrief_replicatePredictionId_key" ON "ContentBrief"("replicatePredictionId");
