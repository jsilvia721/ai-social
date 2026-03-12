-- CreateTable
CREATE TABLE "ErrorReport" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "metadata" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "githubIssueNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ErrorReport_fingerprint_key" ON "ErrorReport"("fingerprint");

-- CreateIndex
CREATE INDEX "ErrorReport_status_lastSeenAt_idx" ON "ErrorReport"("status", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ErrorReport_source_status_idx" ON "ErrorReport"("source", "status");
