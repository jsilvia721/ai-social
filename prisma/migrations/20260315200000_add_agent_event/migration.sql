-- CreateTable
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "businessId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentEvent_businessId_createdAt_idx" ON "AgentEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_eventType_createdAt_idx" ON "AgentEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "AgentEvent_entityType_entityId_idx" ON "AgentEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "AgentEvent" ADD CONSTRAINT "AgentEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
