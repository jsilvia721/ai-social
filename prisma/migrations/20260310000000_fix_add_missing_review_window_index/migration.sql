-- Fix: index was in 20260308200001 but column added later in 20260308d.
-- Use IF NOT EXISTS so this is idempotent (no-op on staging where it already exists).
CREATE INDEX IF NOT EXISTS "Post_status_reviewWindowExpiresAt_idx" ON "Post"("status", "reviewWindowExpiresAt");
