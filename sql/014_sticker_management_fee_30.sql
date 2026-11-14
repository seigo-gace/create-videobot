-- STK-03: new seller-approved sticker/emoji fee, no retroactive fees on existing purchases.
-- Tenths of one Star preserve exact 30/70 calculation, not a payout.
ALTER TABLE videobot_sticker_products
 ADD COLUMN IF NOT EXISTS management_fee_bps INTEGER CHECK(management_fee_bps=3000),
 ADD COLUMN IF NOT EXISTS fee_policy_id TEXT,
 ADD COLUMN IF NOT EXISTS fee_terms_accepted_at TIMESTAMPTZ;
ALTER TABLE videobot_sticker_orders
 ADD COLUMN IF NOT EXISTS management_fee_bps INTEGER CHECK(management_fee_bps=3000),
 ADD COLUMN IF NOT EXISTS fee_policy_id TEXT,
 ADD COLUMN IF NOT EXISTS management_fee_tenths BIGINT,
 ADD COLUMN IF NOT EXISTS creator_share_tenths BIGINT;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sticker_product_fee_pair_ck') THEN
  ALTER TABLE videobot_sticker_products ADD CONSTRAINT sticker_product_fee_pair_ck
   CHECK ((management_fee_bps IS NULL AND fee_policy_id IS NULL AND fee_terms_accepted_at IS NULL)
    OR (management_fee_bps=3000 AND fee_policy_id='sticker-admin-30-20261113' AND fee_terms_accepted_at IS NOT NULL));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sticker_order_fee_pair_ck') THEN
  ALTER TABLE videobot_sticker_orders ADD CONSTRAINT sticker_order_fee_pair_ck
   CHECK ((management_fee_bps IS NULL AND fee_policy_id IS NULL AND management_fee_tenths IS NULL AND creator_share_tenths IS NULL)
    OR (management_fee_bps=3000 AND fee_policy_id='sticker-admin-30-20261113' AND management_fee_tenths=price_stars*3 AND creator_share_tenths=price_stars*7));
 END IF;
END $$;
