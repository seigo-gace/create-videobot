-- Sticker and custom emoji inventory, independent of video sales.
-- Identifiers only: no media bytes, Bot tokens, or buyer payment data.
CREATE TABLE IF NOT EXISTS videobot_sticker_packs (
  pack_name TEXT PRIMARY KEY
    CHECK(pack_name ~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'),
  owner_user_id BIGINT NOT NULL CHECK(owner_user_id > 0),
  kind TEXT NOT NULL CHECK(kind IN ('regular','custom_emoji')),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 64),
  format TEXT NULL CHECK(format IN ('static','video')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','archived','needs_reconcile')),
  telegram_verified_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS videobot_sticker_packs_by_owner
  ON videobot_sticker_packs(owner_user_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS videobot_sticker_default_per_kind
  ON videobot_sticker_packs(owner_user_id,kind)
  WHERE is_default=TRUE AND status='active';

CREATE TABLE IF NOT EXISTS videobot_sticker_items (
  pack_name TEXT NOT NULL REFERENCES videobot_sticker_packs(pack_name),
  file_unique_id TEXT NOT NULL CHECK(char_length(file_unique_id)>0),
  file_id TEXT NOT NULL CHECK(char_length(file_id)>0),
  format TEXT NOT NULL CHECK(format IN ('static','video')),
  emoji TEXT NOT NULL CHECK(char_length(emoji)>0),
  position INTEGER NOT NULL CHECK(position>=0),
  telegram_verified_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(pack_name,file_unique_id)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_items_by_pack_position
  ON videobot_sticker_items(pack_name,position);

CREATE TABLE IF NOT EXISTS videobot_sticker_registration_receipts (
  operation_id TEXT PRIMARY KEY CHECK(char_length(operation_id) BETWEEN 8 AND 128),
  owner_user_id BIGINT NOT NULL CHECK(owner_user_id>0),
  pack_name TEXT NOT NULL CHECK(char_length(pack_name) BETWEEN 1 AND 64),
  source_file_id TEXT NOT NULL CHECK(char_length(source_file_id)>0),
  kind TEXT NOT NULL CHECK(kind IN ('regular','custom_emoji')),
  format TEXT NULL CHECK(format IN ('static','video')),
  file_unique_id TEXT NULL,
  phase TEXT NOT NULL DEFAULT 'preparing'
    CHECK(phase IN ('preparing','uploaded','submission_started','needs_reconcile','registered')),
  latest_error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(phase IN ('preparing','needs_reconcile')
    OR (format IS NOT NULL AND file_unique_id IS NOT NULL)),
  CHECK(phase<>'registered' OR latest_error_code IS NULL)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_reg_pending
  ON videobot_sticker_registration_receipts(owner_user_id,created_at DESC)
  WHERE phase<>'registered';
