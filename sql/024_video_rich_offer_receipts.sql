-- CreateVdobot-only ONE-message RichMessage video offer receipts.
-- Legacy albums, native paid-media receipts and paid Stars transactions remain
-- untouched. Never store placeholder message IDs for an album.
CREATE TABLE IF NOT EXISTS videobot_rich_offer_receipts (
  delivery_key TEXT PRIMARY KEY CHECK(delivery_key ~ '^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$'),
  listing_id TEXT NOT NULL REFERENCES videobot_listings(listing_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision>0),
  topic_id BIGINT NOT NULL CHECK(topic_id>0),
  status TEXT NOT NULL CHECK(status IN ('sending','sent','needs_reconcile')),
  message_id BIGINT NULL CHECK(message_id IS NULL OR message_id>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id,revision),
  CHECK(status<>'sent' OR message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_rich_offer_reconcile
  ON videobot_rich_offer_receipts(updated_at)
  WHERE status='needs_reconcile';

-- Invoice orders must be allowed to reference either an original invoice
-- offer or a verified RichMessage offer; the reserve query checks this
-- UNION explicitly. Keep the existing FK to the owned listing intact.
-- No financial rows are deleted or recreated.
ALTER TABLE videobot_video_invoice_orders
  DROP CONSTRAINT IF EXISTS videobot_video_invoice_orders_delivery_key_fkey;
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid='videobot_video_invoice_orders'::regclass
     AND conname='videobot_video_invoice_orders_delivery_key_format_check'
 ) THEN
  ALTER TABLE videobot_video_invoice_orders
   ADD CONSTRAINT videobot_video_invoice_orders_delivery_key_format_check
   CHECK(delivery_key ~ '^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$');
 END IF;
END $$;
