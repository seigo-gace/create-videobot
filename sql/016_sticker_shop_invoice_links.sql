-- STK-03: a Mini App invoice URL is not a sent DM invoice message.
-- Reuse immutable sticker orders, seller's 30/70 terms and payment receipts.
-- Explicit link_ready state allows pre-checkout only AFTER durable URL issuance.
ALTER TABLE videobot_sticker_orders
 ADD COLUMN IF NOT EXISTS invoice_url TEXT NULL;
ALTER TABLE videobot_sticker_orders
 DROP CONSTRAINT IF EXISTS videobot_sticker_orders_invoice_state_check;
ALTER TABLE videobot_sticker_orders ADD CONSTRAINT videobot_sticker_orders_invoice_state_check
 CHECK(invoice_state IN ('prepared','sending','sent','link_ready','unknown','paid'));
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sticker_invoice_link_receipt_check') THEN
  ALTER TABLE videobot_sticker_orders ADD CONSTRAINT sticker_invoice_link_receipt_check
   CHECK(invoice_state <> 'link_ready' OR
    (invoice_url LIKE 'https://t.me/$%' AND char_length(invoice_url) BETWEEN 17 AND 2048));
 END IF;
END $$;
