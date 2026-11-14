-- STK-04: the seller Bot itself owns the Topic entry message and pin.
-- GateApp-Bot's read-only routing identity remains external.
CREATE TABLE IF NOT EXISTS videobot_sticker_entry_pins (
 entry_key TEXT PRIMARY KEY CHECK(entry_key='sticker'),
 chat_id BIGINT NOT NULL CHECK(chat_id < 0),
 thread_id BIGINT NOT NULL CHECK(thread_id > 0),
 bot_id BIGINT NOT NULL CHECK(bot_id > 0),
 bot_username TEXT NOT NULL CHECK(lower(bot_username)='createvdobot'),
 status TEXT NOT NULL CHECK(status IN (
   'sending','sent','pin_requested','pinned_ack','needs_reconcile')),
 telegram_message_id BIGINT CHECK(telegram_message_id > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(status='sending' OR status='needs_reconcile' OR telegram_message_id IS NOT NULL)
);
