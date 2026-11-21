-- STK-04 VideoBot receipt for GateApp-Bot-owned verified Telegram Topic.
-- Only publication state is owned here. Topic identity and pin ownership
-- remain in the GateApp-Bot canonical registry.
CREATE TABLE IF NOT EXISTS videobot_sticker_topic_posts (
 product_id TEXT PRIMARY KEY REFERENCES videobot_sticker_products(product_id) ON DELETE RESTRICT,
 seller_user_id BIGINT NOT NULL CHECK(seller_user_id>0),
 chat_id BIGINT NOT NULL CHECK(chat_id<0),
 message_thread_id BIGINT NOT NULL CHECK(message_thread_id>0),
 group_title TEXT NOT NULL CHECK(char_length(group_title) BETWEEN 1 AND 120),
 topic_title TEXT NOT NULL CHECK(char_length(topic_title) BETWEEN 1 AND 120),
 display_text TEXT NOT NULL CHECK(char_length(display_text) BETWEEN 1 AND 4096),
 status TEXT NOT NULL CHECK(status IN ('sending','sent','needs_reconcile','deleted')),
 telegram_message_id BIGINT NULL CHECK(telegram_message_id>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(status NOT IN ('sent','deleted') OR telegram_message_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS videobot_sticker_topic_posts_owner
 ON videobot_sticker_topic_posts(seller_user_id,created_at DESC);
