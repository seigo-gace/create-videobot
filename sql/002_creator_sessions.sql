-- VideoBot-owned seller draft sessions. Do not write into GateApp-Bot's
-- profile/public_post_drafts or GATE administrator sessions.
-- Persist only JSON refs/field values, never raw video or Telegram tokens.
CREATE TABLE IF NOT EXISTS videobot_creator_sessions (
  owner_user_id BIGINT PRIMARY KEY CHECK(owner_user_id > 0),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  screen_message_id BIGINT NULL CHECK(screen_message_id > 0),
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS videobot_creator_sessions_updated
  ON videobot_creator_sessions(updated_at);
