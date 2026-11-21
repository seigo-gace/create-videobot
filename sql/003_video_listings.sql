-- VideoBot product listing owner schema. Use only with VideoBot private DB.
-- Media bytes remain on approved Telegram/private media storage; SQL stores
-- only file references and product metadata. No purchase/payment secrets.
CREATE TABLE IF NOT EXISTS videobot_listings (
  listing_id TEXT PRIMARY KEY CHECK (char_length(listing_id) BETWEEN 1 AND 40),
  seller_user_id BIGINT NOT NULL CHECK (seller_user_id > 0),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  title TEXT NOT NULL DEFAULT '' CHECK(char_length(title) <= 128),
  price_stars INTEGER NULL CHECK(price_stars BETWEEN 1 AND 25000),
  price_mode TEXT NOT NULL DEFAULT 'preset' CHECK(price_mode IN ('preset','custom')),
  thumbnail_file_id TEXT NULL,
  sample_file_id TEXT NULL,
  sample_duration_seconds DOUBLE PRECISION NULL CHECK(sample_duration_seconds > 0 AND sample_duration_seconds <= 30),
  paid_video_file_id TEXT NULL,
  rights_verified BOOLEAN NOT NULL DEFAULT FALSE,
  adult_consent_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','published','paused','removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sample_file_id IS NULL OR sample_duration_seconds IS NOT NULL),
  CHECK (status NOT IN ('ready','published') OR
    (title<>'' AND price_stars IS NOT NULL AND thumbnail_file_id IS NOT NULL AND
     sample_file_id IS NOT NULL AND paid_video_file_id IS NOT NULL AND
     rights_verified=TRUE AND adult_consent_verified=TRUE))
);
CREATE INDEX IF NOT EXISTS videobot_listings_owner_updated
  ON videobot_listings(seller_user_id,updated_at DESC);
