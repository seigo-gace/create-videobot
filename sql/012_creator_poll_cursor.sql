-- Single CreatorBot Telegram long-poll consumer; durable offset after
-- existing videobot_webhook_updates receipt is committed.
CREATE TABLE IF NOT EXISTS videobot_poll_cursor (
  consumer_id TEXT PRIMARY KEY CHECK(consumer_id='createvdobot'),
  last_update_id BIGINT NOT NULL CHECK(last_update_id>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
