-- CreateVdobot private financial-media delivery schema.
-- Apply only to the VideoBot-owned PostgreSQL database, NEVER directly
-- to the GateApp-Bot shared MPB or Gserver databases.
CREATE TABLE IF NOT EXISTS videobot_post_receipts (
  delivery_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  topic_id BIGINT NOT NULL CHECK (topic_id > 0),
  status TEXT NOT NULL CHECK(status IN ('sending','sent','needs_reconcile')),
  free_message_ids BIGINT[] NULL CHECK(
    free_message_ids IS NULL OR
    (array_length(free_message_ids,1)=2 AND free_message_ids[1]>0 AND
      free_message_ids[2]>0 AND free_message_ids[1]<>free_message_ids[2])
  ),
  paid_message_id BIGINT NULL CHECK(paid_message_id IS NULL OR paid_message_id>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status<>'sent' OR (free_message_ids IS NOT NULL AND paid_message_id IS NOT NULL)),
  UNIQUE(listing_id,revision)
);
CREATE INDEX IF NOT EXISTS videobot_receipt_needs_reconcile
 ON videobot_post_receipts(updated_at) WHERE status='needs_reconcile';
