-- Add fulfillment fields to ContentBrief
ALTER TABLE "ContentBrief" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ContentBrief" ADD COLUMN "errorMessage" TEXT;

-- Add unique constraint on Post.briefId (prevents duplicate posts per brief)
ALTER TABLE "Post" ADD CONSTRAINT "Post_briefId_key" UNIQUE ("briefId");

-- Add indexes for auto-approval, review queue, and daily cap queries
CREATE INDEX "Post_status_reviewWindowExpiresAt_idx" ON "Post"("status", "reviewWindowExpiresAt");
CREATE INDEX "Post_businessId_status_idx" ON "Post"("businessId", "status");
CREATE INDEX "Post_businessId_createdAt_idx" ON "Post"("businessId", "createdAt");
