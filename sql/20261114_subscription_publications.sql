-- Isolated monthly channel subscription. NEVER modify single-item Stars ledger.
-- Apply only after confirming existing target schema and migration ownership.
CREATE TABLE IF NOT EXISTS videobot_subscription_publications (
  source_channel_id BIGINT NOT NULL,
  source_message_id BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('member_full','sample')),
  target_chat_id BIGINT NOT NULL,
  target_thread_id BIGINT,
  telegram_message_id BIGINT,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','needs_reconcile')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_channel_id,source_message_id,kind),
  CHECK (status <> 'sent' OR telegram_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_subscription_pub_target_idx
 ON videobot_subscription_publications(target_chat_id,telegram_message_id);

CREATE TABLE IF NOT EXISTS videobot_subscription_previews (
  source_channel_id BIGINT NOT NULL,
  source_message_id BIGINT NOT NULL,
  preview_storage_key TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION NOT NULL CHECK (duration_seconds > 0 AND duration_seconds <= 60),
  streaming_ready BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_channel_id,source_message_id)
);
