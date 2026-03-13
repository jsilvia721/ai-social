-- CreateTable
CREATE TABLE "BrainstormSession" (
    "id" TEXT NOT NULL,
    "githubIssueNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastProcessedCommentId" INTEGER,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainstormSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrainstormSession_githubIssueNumber_key" ON "BrainstormSession"("githubIssueNumber");

-- CreateIndex
CREATE INDEX "BrainstormSession_status_idx" ON "BrainstormSession"("status");
