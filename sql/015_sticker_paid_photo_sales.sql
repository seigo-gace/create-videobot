-- STK-03/STK-04: native Telegram paid PHOTO unlock of an immutable sticker pack.
-- It is not a paid video and does not modify the video ledger.
-- Native paid media charges are independent of XTR sendInvoice payment receipts.
CREATE TABLE IF NOT EXISTS videobot_sticker_paid_photo_sales (
 sale_id BIGSERIAL PRIMARY KEY,
 telegram_transaction_id TEXT NOT NULL UNIQUE CHECK(char_length(telegram_transaction_id) BETWEEN 1 AND 256),
 telegram_update_id BIGINT NOT NULL UNIQUE CHECK(telegram_update_id>=0),
 product_id TEXT NOT NULL REFERENCES videobot_sticker_products(product_id) ON DELETE RESTRICT,
 buyer_user_id BIGINT NOT NULL CHECK(buyer_user_id>0),
 stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 25000),
 management_fee_bps INTEGER NOT NULL DEFAULT 3000 CHECK(management_fee_bps=3000),
 fee_policy_id TEXT NOT NULL DEFAULT 'sticker-admin-30-20261113'
   CHECK(fee_policy_id='sticker-admin-30-20261113'),
 management_fee_tenths BIGINT NOT NULL CHECK(management_fee_tenths=stars*3),
 creator_share_tenths BIGINT NOT NULL CHECK(creator_share_tenths=stars*7),
 paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS videobot_sticker_paid_photo_buyer
 ON videobot_sticker_paid_photo_sales(buyer_user_id,paid_at DESC);
CREATE TABLE IF NOT EXISTS videobot_sticker_paid_photo_delivery (
 sale_id BIGINT NOT NULL REFERENCES videobot_sticker_paid_photo_sales(sale_id) ON DELETE RESTRICT,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 1000),
 item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 199),
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','sending','sent','unknown')),
 telegram_message_id BIGINT NULL CHECK(telegram_message_id>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(sale_id,attempt,item_index),
 CHECK(status <> 'sent' OR telegram_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_paid_photo_delivery_pending
 ON videobot_sticker_paid_photo_delivery(sale_id,attempt,status);
