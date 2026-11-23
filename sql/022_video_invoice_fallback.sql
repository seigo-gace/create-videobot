-- Dedicated video-invoice route. Applies only to the CreateVdobot-owned DB.
-- Native paid-media receipts keep their existing status and paid message IDs.
ALTER TABLE videobot_post_receipts
  ADD COLUMN IF NOT EXISTS sale_mode TEXT NOT NULL DEFAULT 'paid_media';
ALTER TABLE videobot_post_receipts
  DROP CONSTRAINT IF EXISTS videobot_post_receipts_sale_mode_check;
ALTER TABLE videobot_post_receipts
  ADD CONSTRAINT videobot_post_receipts_sale_mode_check
  CHECK (sale_mode IN ('paid_media','invoice'));

CREATE TABLE IF NOT EXISTS videobot_video_invoice_orders (
  order_id TEXT PRIMARY KEY CHECK (order_id ~ '^vi_[a-f0-9]{24}$'),
  delivery_key TEXT NOT NULL REFERENCES videobot_post_receipts(delivery_key) ON DELETE RESTRICT,
  listing_id TEXT NOT NULL REFERENCES videobot_listings(listing_id) ON DELETE RESTRICT,
  buyer_user_id BIGINT NOT NULL CHECK (buyer_user_id > 0),
  seller_user_id BIGINT NOT NULL CHECK (seller_user_id > 0),
  price_stars INTEGER NOT NULL CHECK (price_stars BETWEEN 1 AND 25000),
  video_file_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'prepared','sending','sent','invoice_unknown',
    'paid','delivering','delivered','delivery_unknown')),
  invoice_message_id BIGINT NULL,
  telegram_payment_charge_id TEXT NULL,
  telegram_update_id BIGINT NULL,
  delivered_message_id BIGINT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(delivery_key,buyer_user_id),
  UNIQUE(telegram_payment_charge_id),
  CHECK (status <> 'delivered' OR delivered_message_id > 0)
);
CREATE INDEX IF NOT EXISTS videobot_video_invoice_reconcile
  ON videobot_video_invoice_orders(updated_at)
  WHERE status IN ('invoice_unknown','delivering','delivery_unknown');
