-- Durable exceptional inbox for updates whose business result was ambiguous.
-- Only the single CreatorBot poller writes this private table. The original
-- message is retained for authorized reconciliation BEFORE offset advancement.
-- No Telegram update data is printed to CI, GitHub issue logs, or Bot DM.
-- Publication and payment events are never re-executed by this quarantine.
CREATE TABLE IF NOT EXISTS videobot_poll_quarantine (
  update_id BIGINT PRIMARY KEY CHECK(update_id >= 0),
  payload_sha256 CHAR(64) NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  reason TEXT NOT NULL CHECK(reason = 'WEBHOOK_UPDATE_NEEDS_RECONCILE'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS videobot_poll_quarantine_pending
 ON videobot_poll_quarantine(created_at) WHERE resolved_at IS NULL;
