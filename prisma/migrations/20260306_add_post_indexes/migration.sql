-- CreateIndex
CREATE INDEX "Post_userId_status_scheduledAt_idx" ON "Post"("userId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Post_userId_scheduledAt_idx" ON "Post"("userId", "scheduledAt");
