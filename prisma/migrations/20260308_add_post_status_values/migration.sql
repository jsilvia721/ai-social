-- Non-transactional migration: ALTER TYPE ... ADD VALUE cannot run inside a transaction in Postgres < 16
-- See migration.toml sibling file: transactional = false
ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'RETRYING';
ALTER TYPE "PostStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING';
