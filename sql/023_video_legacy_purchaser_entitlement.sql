-- Previously purchased native Stars paid-media must retain buyer access when
-- the original offer is replaced by a new invoice-based public listing.
-- Never change original Stars ledger rows or treat historic access as revenue.
CREATE TABLE IF NOT EXISTS videobot_video_legacy_deliveries (
  delivery_key TEXT NOT NULL REFERENCES videobot_post_receipts(delivery_key) ON DELETE RESTRICT,
  buyer_user_id BIGINT NOT NULL CHECK (buyer_user_id>0),
  original_telegram_transaction_id TEXT NOT NULL,
  video_file_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('delivering','delivered','delivery_unknown')),
  delivered_message_id BIGINT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (delivery_key,buyer_user_id),
  CHECK(status<>'delivered' OR delivered_message_id>0)
);
CREATE INDEX IF NOT EXISTS videobot_video_legacy_reconcile
 ON videobot_video_legacy_deliveries(updated_at)
 WHERE status IN ('delivering','delivery_unknown');
