-- Issue #527: multi-currency support for Stripe payments.
-- Stores the currency and amount actually charged (locked at order creation
-- time) alongside the NGN reference amount already on the gifts table.
ALTER TABLE gifts
  ADD COLUMN IF NOT EXISTS payment_currency TEXT NOT NULL DEFAULT 'ngn',
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC;

COMMENT ON COLUMN gifts.payment_currency IS 'Currency actually charged: ngn (Paystack), usd/gbp/eur (Stripe)';
COMMENT ON COLUMN gifts.payment_amount IS 'Amount charged in payment_currency major units, locked at order creation';
