/**
 * One-time additive prerequisite for the reply-free RichMessage receipt.
 * Matches sql/024's own table/index contract WITHOUT dropping/modifying
 * any Stars-ledger or invoice-order foreign keys.
 */
export async function ensureRichOfferClaimTable(pool){
 if(typeof pool?.query!=='function')throw Error('VIDEO_RECEIPT_DB_REQUIRED');
 await pool.query(
  "CREATE TABLE IF NOT EXISTS videobot_rich_offer_receipts (delivery_key TEXT PRIMARY KEY CHECK(delivery_key ~ '^[A-Za-z0-9_-]{1,40}:[1-9][0-9]*$'), listing_id TEXT NOT NULL REFERENCES videobot_listings(listing_id) ON DELETE RESTRICT, revision INTEGER NOT NULL CHECK(revision>0), topic_id BIGINT NOT NULL CHECK(topic_id>0), status TEXT NOT NULL CHECK(status IN ('sending','sent','needs_reconcile')), message_id BIGINT NULL CHECK(message_id IS NULL OR message_id>0), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(listing_id,revision), CHECK(status<>'sent' OR message_id IS NOT NULL))"
 );
 await pool.query(
  "CREATE INDEX IF NOT EXISTS videobot_rich_offer_reconcile ON videobot_rich_offer_receipts(updated_at) WHERE status='needs_reconcile'"
 );
 const present=(await pool.query(
  "SELECT to_regclass('public.videobot_rich_offer_receipts') IS NOT NULL AS available"
 )).rows;
 if(present.length!==1||present[0].available!==true)
  throw Error('VIDEO_RICH_RECEIPT_SCHEMA_UNAVAILABLE');
}
