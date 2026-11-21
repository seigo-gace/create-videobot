-- CreateVdoBot: immutable Stars purchase/refund evidence, in the VideoBot-owned DB.
-- Apply AFTER 001_video_post_receipts.sql and 003_video_listings.sql.
-- The Bot API balance belongs to the Bot owner; these records are NOT
-- transferable creator balances and authorize NO direct Stars payouts.
CREATE TABLE IF NOT EXISTS videobot_stars_ledger (
  ledger_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_transaction_id TEXT NOT NULL CHECK(char_length(telegram_transaction_id) BETWEEN 1 AND 256),
  kind TEXT NOT NULL CHECK(kind IN ('paid','refunded')),
  delivery_key TEXT NOT NULL REFERENCES videobot_post_receipts(delivery_key) ON DELETE RESTRICT,
  listing_id TEXT NOT NULL REFERENCES videobot_listings(listing_id) ON DELETE RESTRICT,
  seller_user_id BIGINT NOT NULL CHECK(seller_user_id>0),
  buyer_user_id BIGINT NOT NULL CHECK(buyer_user_id>0),
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 25000),
  telegram_update_id BIGINT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (telegram_transaction_id,kind),
  CHECK (telegram_update_id IS NULL OR telegram_update_id>=0)
);
CREATE INDEX IF NOT EXISTS videobot_stars_ledger_seller
  ON videobot_stars_ledger(seller_user_id,recorded_at DESC);
CREATE INDEX IF NOT EXISTS videobot_stars_ledger_listing
  ON videobot_stars_ledger(listing_id,recorded_at DESC);
