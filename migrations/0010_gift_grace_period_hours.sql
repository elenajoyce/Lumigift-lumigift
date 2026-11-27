-- Migration: 0010_gift_grace_period_hours
-- Issue #508 — Gift expiry grace period enforcement
--
-- Adds a per-gift grace period (in hours) measured from `unlock_at`. The
-- expire cron must not move a gift into `expired_pending_refund` until
-- `NOW() > unlock_at + grace_period_hours`. NULL defaults to 72 hours.
-- Business accounts may configure a longer/shorter grace period per gift.

ALTER TABLE gifts ADD COLUMN IF NOT EXISTS grace_period_hours INTEGER;

COMMENT ON COLUMN gifts.grace_period_hours IS
  'Hours after unlock_at before the gift is eligible for expiry processing. NULL = default (72h).';
