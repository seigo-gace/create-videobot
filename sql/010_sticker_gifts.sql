-- STK-03 purchased-sticker gifting. Independent of Stars charge ledger.
-- A single-use gift grants a recipient a copy of an immutable purchased
-- product snapshot; donor purchase, charge, seller payout and receipts remain.
-- Each link may be redeemed by exactly one Telegram user, once; gift links
-- are bearer secrets, so persist only SHA-256 digests, never raw tokens.
CREATE TABLE IF NOT EXISTS videobot_sticker_gifts (
 gift_id TEXT PRIMARY KEY CHECK (gift_id ~ '^sg_[a-f0-9]{24}$'),
 donor_order_id TEXT NOT NULL REFERENCES videobot_sticker_orders(order_id)
   ON DELETE RESTRICT,
 donor_user_id BIGINT NOT NULL CHECK (donor_user_id>0),
 token_sha256 CHAR(64) NOT NULL UNIQUE
   CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
 recipient_user_id BIGINT NULL CHECK (recipient_user_id>0),
 redeemed_at TIMESTAMPTZ NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK ((recipient_user_id IS NULL AND redeemed_at IS NULL) OR
        (recipient_user_id IS NOT NULL AND redeemed_at IS NOT NULL)),
 CHECK (recipient_user_id IS NULL OR recipient_user_id <> donor_user_id)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_gifts_donor
 ON videobot_sticker_gifts(donor_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS videobot_sticker_gifts_received
 ON videobot_sticker_gifts(recipient_user_id,redeemed_at DESC)
 WHERE recipient_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS videobot_sticker_gift_delivery_items (
 gift_id TEXT NOT NULL REFERENCES videobot_sticker_gifts(gift_id)
   ON DELETE RESTRICT,
 attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 1000),
 item_index INTEGER NOT NULL CHECK (item_index BETWEEN 0 AND 199),
 status TEXT NOT NULL DEFAULT 'pending'
   CHECK (status IN ('pending','sending','sent','unknown')),
 telegram_message_id BIGINT NULL CHECK (telegram_message_id>0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(gift_id,attempt,item_index),
 CHECK (status <> 'sent' OR telegram_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_gift_delivery_status
 ON videobot_sticker_gift_delivery_items(gift_id,attempt,status);
