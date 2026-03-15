-- CreateTable
CREATE TABLE "CronConfig" (
    "id" TEXT NOT NULL,
    "cronName" TEXT NOT NULL,
    "scheduleExpression" TEXT NOT NULL,
    "scheduleType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "intervalValue" INTEGER,
    "intervalUnit" TEXT,
    "dayOfWeek" TEXT,
    "hourUtc" INTEGER,
    "syncStatus" TEXT NOT NULL DEFAULT 'SYNCED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CronConfig_cronName_key" ON "CronConfig"("cronName");

-- Seed default cron configurations matching sst.config.ts
INSERT INTO "CronConfig" ("id", "cronName", "scheduleExpression", "scheduleType", "enabled", "intervalValue", "intervalUnit", "dayOfWeek", "hourUtc", "syncStatus", "updatedAt")
VALUES
    (gen_random_uuid()::text, 'publish',    'rate(1 minute)',           'rate', true, 1,    'minutes', NULL,  NULL, 'SYNCED', NOW()),
    (gen_random_uuid()::text, 'metrics',    'rate(60 minutes)',         'rate', true, 60,   'minutes', NULL,  NULL, 'SYNCED', NOW()),
    (gen_random_uuid()::text, 'research',   'cron(0 */4 * * ? *)',     'cron', true, NULL,  NULL,      NULL,  NULL, 'SYNCED', NOW()),
    (gen_random_uuid()::text, 'briefs',     'cron(0 23 ? * SUN *)',    'cron', true, NULL,  NULL,      'SUN', 23,   'SYNCED', NOW()),
    (gen_random_uuid()::text, 'fulfill',    'rate(6 hours)',            'rate', true, 6,    'hours',   NULL,  NULL, 'SYNCED', NOW()),
    (gen_random_uuid()::text, 'optimize',   'cron(0 2 ? * SUN *)',     'cron', true, NULL,  NULL,      'SUN', 2,    'SYNCED', NOW()),
    (gen_random_uuid()::text, 'brainstorm', 'rate(60 minutes)',         'rate', true, 60,   'minutes', NULL,  NULL, 'SYNCED', NOW());
