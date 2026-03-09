-- Non-transactional migration: ALTER TYPE ... ADD VALUE cannot run inside a transaction in Postgres < 16
-- See migration.toml sibling file: transactional = false
ALTER TYPE "BriefStatus" ADD VALUE IF NOT EXISTS 'FULFILLING';
ALTER TYPE "BriefStatus" ADD VALUE IF NOT EXISTS 'FAILED';
