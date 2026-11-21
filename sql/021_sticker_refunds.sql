-- VIDEO / STK / emoji Stars: durable, verified *negative* transaction evidence.
-- Source payment owners and purchase rights remain separate; no refund API call
-- is made by accounting reconciliation. No new wallet or payout authority.
CREATE TABLE IF NOT EXISTS videobot_sticker_refunds (
 refund_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 telegram_transaction_id TEXT NOT NULL UNIQUE
   CHECK (char_length(telegram_transaction_id) BETWEEN 1 AND 256),
 source TEXT NOT NULL CHECK(source IN ('sticker_pack','sticker_paid_photo')),
 order_id TEXT NULL REFERENCES videobot_sticker_orders(order_id) ON DELETE RESTRICT,
 sale_id BIGINT NULL REFERENCES videobot_sticker_paid_photo_sales(sale_id) ON DELETE RESTRICT,
 buyer_user_id BIGINT NOT NULL CHECK(buyer_user_id>0),
 stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 25000),
 management_fee_tenths BIGINT NOT NULL CHECK(management_fee_tenths=stars*3),
 creator_share_tenths BIGINT NOT NULL CHECK(creator_share_tenths=stars*7),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (
   (source='sticker_pack' AND order_id IS NOT NULL AND sale_id IS NULL) OR
   (source='sticker_paid_photo' AND order_id IS NULL AND sale_id IS NOT NULL)
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS videobot_sticker_refund_order
 ON videobot_sticker_refunds(order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS videobot_sticker_refund_photo
 ON videobot_sticker_refunds(sale_id) WHERE sale_id IS NOT NULL;
-- Refunded products remain in immutable purchase ledgers and existing delivery
-- records; a later entitlement-policy change requires separate adopted scope.

-- Keep progress across polling restarts when the bot has more than 300
-- Stars transactions. A full traversal restarts at offset zero so newer
-- transactions are also rechecked. No second polling process is created.
CREATE TABLE IF NOT EXISTS videobot_stars_refund_audit_cursor (
 cursor_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(cursor_id=1),
 next_offset INTEGER NOT NULL DEFAULT 0 CHECK(next_offset>=0),
 last_complete_at TIMESTAMPTZ NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
