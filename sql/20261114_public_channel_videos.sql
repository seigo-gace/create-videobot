-- Collected public-channel video metadata; isolated from paid-video sales tables.
CREATE TABLE IF NOT EXISTS videobot_public_channel_videos (
  channel_id BIGINT NOT NULL,
  channel_username TEXT NOT NULL,
  channel_title TEXT NOT NULL DEFAULT '',
  message_id BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  file_unique_id TEXT,
  message_date TIMESTAMPTZ,
  caption TEXT NOT NULL DEFAULT '',
  downloaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id,message_id)
);
CREATE INDEX IF NOT EXISTS videobot_public_video_downloaded_idx
  ON videobot_public_channel_videos (downloaded_at DESC);
