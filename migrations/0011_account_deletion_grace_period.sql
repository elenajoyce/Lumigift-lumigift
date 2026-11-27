-- Migration: account deletion grace period (Issue #516)
--
-- DELETE /api/v1/users/me previously anonymised the account immediately.
-- This migration adds the columns needed to schedule deletion 30 days out,
-- email/SMS a reactivation link, and let a cron job perform the permanent
-- purge once the grace period has elapsed.

ALTER TABLE users ADD COLUMN IF NOT EXISTS scheduled_deletion_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_cancel_token TEXT;

CREATE INDEX IF NOT EXISTS idx_users_scheduled_deletion_at
  ON users (scheduled_deletion_at)
  WHERE scheduled_deletion_at IS NOT NULL;

COMMENT ON COLUMN users.scheduled_deletion_at IS
  'Set by DELETE /api/v1/users/me. The cron purge job anonymises the account '
  'once NOW() >= scheduled_deletion_at. NULL means no deletion is pending.';

COMMENT ON COLUMN users.deletion_cancel_token IS
  'Single-use token emailed/SMS-ed to the user at deletion request time. '
  'POST /api/v1/users/me/deletion/cancel with this token aborts the pending '
  'deletion by clearing both columns.';
