-- Adopted fee terms 2026-11-07. Append-only migration, never modify
-- GateApp-Bot, MPB, existing payment gateways, or live Stars balances.
-- Requires 001..004. On a pre-existing paid ledger, stop for a reviewed,
-- transaction-by-transaction migration rather than retroactively charging.
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema=current_schema() AND table_name='videobot_stars_ledger'
    AND column_name='management_fee_bps'
 ) AND EXISTS (SELECT 1 FROM videobot_stars_ledger) THEN
   RAISE EXCEPTION 'Existing Stars records require an explicit historical fee transition before migration 005';
 END IF;
END $$;

ALTER TABLE videobot_listings
 ADD COLUMN IF NOT EXISTS management_fee_bps INTEGER NOT NULL DEFAULT 3000
 CHECK (management_fee_bps=3000),
 ADD COLUMN IF NOT EXISTS fee_policy_id TEXT NOT NULL DEFAULT 'video-admin-30-20261107'
 CHECK (fee_policy_id='video-admin-30-20261107'),
 ADD COLUMN IF NOT EXISTS fee_terms_accepted_at TIMESTAMPTZ NULL;

ALTER TABLE videobot_stars_ledger
 ADD COLUMN IF NOT EXISTS management_fee_bps INTEGER NOT NULL DEFAULT 3000
 CHECK (management_fee_bps=3000),
 ADD COLUMN IF NOT EXISTS fee_policy_id TEXT NOT NULL DEFAULT 'video-admin-30-20261107'
 CHECK (fee_policy_id='video-admin-30-20261107');

COMMENT ON COLUMN videobot_stars_ledger.management_fee_bps IS
 '30 percent operator administration fee at transaction time; no direct creator payout permitted.';
COMMENT ON COLUMN videobot_listings.fee_terms_accepted_at IS
 'Explicit seller confirmation of 30-percent management fee immediately before first publication.';
