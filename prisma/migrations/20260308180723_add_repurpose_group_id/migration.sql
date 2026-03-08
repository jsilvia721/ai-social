-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "repurposeGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Post_repurposeGroupId_idx" ON "Post"("repurposeGroupId");
