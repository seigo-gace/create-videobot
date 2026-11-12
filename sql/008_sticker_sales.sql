-- STK-03 immutable sticker product versions, invoice orders and delivery receipts.
-- Owner is CreateVdobot; video paid-media ledgers and fees remain untouched.
-- No media bytes or financial credentials stored here. File IDs are Telegram
-- references; durable independent media retention must be separately verified.
CREATE TABLE IF NOT EXISTS videobot_sticker_products (
 product_id TEXT PRIMARY KEY CHECK(product_id ~ '^sp_[a-f0-9]{24}$'),
 pack_name TEXT NOT NULL REFERENCES videobot_sticker_packs(pack_name) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(version > 0),
 seller_user_id BIGINT NOT NULL CHECK(seller_user_id > 0),
 kind TEXT NOT NULL CHECK(kind IN ('regular','custom_emoji')),
 title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 64),
 price_stars INTEGER NOT NULL CHECK(price_stars BETWEEN 1 AND 25000),
 items JSONB NOT NULL CHECK(jsonb_typeof(items)='array' AND jsonb_array_length(items) BETWEEN 1 AND 200),
 -- Price, item snapshot and version never edited after publication.
 status TEXT NOT NULL DEFAULT 'published'
   CHECK(status IN ('published','paused')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(pack_name,version)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_products_owner
 ON videobot_sticker_products(seller_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS videobot_sticker_orders (
 order_id TEXT PRIMARY KEY CHECK(order_id ~ '^so_[a-f0-9]{24}$'),
 product_id TEXT NOT NULL REFERENCES videobot_sticker_products(product_id) ON DELETE RESTRICT,
 buyer_user_id BIGINT NOT NULL CHECK(buyer_user_id>0),
 price_stars INTEGER NOT NULL CHECK(price_stars BETWEEN 1 AND 25000),
 currency TEXT NOT NULL DEFAULT 'XTR' CHECK(currency='XTR'),
 terms_accepted_at TIMESTAMPTZ NOT NULL,
 invoice_state TEXT NOT NULL DEFAULT 'prepared'
   CHECK(invoice_state IN ('prepared','sending','sent','unknown','paid')),
 invoice_message_id BIGINT NULL CHECK(invoice_message_id>0),
 telegram_payment_charge_id TEXT UNIQUE,
 payment_update_id BIGINT UNIQUE,
 paid_at TIMESTAMPTZ NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(product_id,buyer_user_id),
 CHECK(invoice_state <> 'paid' OR
       (telegram_payment_charge_id IS NOT NULL AND paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS videobot_sticker_orders_buyer
 ON videobot_sticker_orders(buyer_user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS videobot_sticker_delivery_items (
 order_id TEXT NOT NULL REFERENCES videobot_sticker_orders(order_id) ON DELETE RESTRICT,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 1000),
 item_index INTEGER NOT NULL CHECK(item_index BETWEEN 0 AND 199),
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','sending','sent','unknown')),
 telegram_message_id BIGINT NULL CHECK(telegram_message_id>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(order_id,attempt,item_index),
 CHECK(status <> 'sent' OR telegram_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_delivery_pending
 ON videobot_sticker_delivery_items(order_id,attempt,status);
