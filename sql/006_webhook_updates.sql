-- VideoBot-only Telegram update admission idempotence.
-- This table holds update IDs and SHA-256 fingerprints, not raw messages,
-- tokens, buyer IDs, media bytes or payment payloads.
CREATE TABLE IF NOT EXISTS videobot_webhook_updates (
  update_id BIGINT PRIMARY KEY CHECK(update_id >= 0),
  payload_sha256 CHAR(64) NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL CHECK(status IN ('processing','completed','needs_reconcile')),
  handled BOOLEAN NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status='completed' AND handled IS NOT NULL) OR
         (status<>'completed' AND handled IS NULL))
);
CREATE INDEX IF NOT EXISTS videobot_webhook_updates_status
 ON videobot_webhook_updates(status,updated_at);
