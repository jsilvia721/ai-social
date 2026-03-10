-- Add unique constraint on SocialAccount.blotatoAccountId
CREATE UNIQUE INDEX "SocialAccount_blotatoAccountId_key" ON "SocialAccount"("blotatoAccountId");

-- Add missing performance indexes
CREATE INDEX "SocialAccount_businessId_idx" ON "SocialAccount"("businessId");
CREATE INDEX "BusinessMember_userId_idx" ON "BusinessMember"("userId");
CREATE INDEX "Post_businessId_publishedAt_idx" ON "Post"("businessId", "publishedAt");
CREATE INDEX "ContentBrief_businessId_scheduledFor_idx" ON "ContentBrief"("businessId", "scheduledFor");
