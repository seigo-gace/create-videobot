-- PostgreSQL 16 isolated CI smoke. No real Telegram IDs, payments or user data.
BEGIN;
INSERT INTO videobot_listings
 (listing_id,seller_user_id,revision,title,price_stars,price_mode,
  thumbnail_file_id,sample_file_id,sample_duration_seconds,paid_video_file_id,
  rights_verified,adult_consent_verified,status)
VALUES
 ('ci_video_01',44,2,'CI TEST ONLY',300,'preset',
  'ci_photo_id','ci_sample_id',30,'ci_paid_file',
  TRUE,TRUE,'published');

INSERT INTO videobot_post_receipts
 (delivery_key,listing_id,revision,topic_id,status,free_message_ids,paid_message_id)
VALUES
 ('ci_video_01:1','ci_video_01',1,15,'sent',ARRAY[101,102]::BIGINT[],103);

INSERT INTO videobot_creator_sessions
 (owner_user_id,revision,screen_message_id,state)
VALUES (44,1,51,'{"draft":{"mode":"create","title":"CI-only"},"waiting":null}'::JSONB);

INSERT INTO videobot_stars_ledger
 (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,
  buyer_user_id,stars,telegram_update_id)
VALUES ('ci_transaction_123','paid','ci_video_01:1','ci_video_01',44,77,300,55);

-- The same official transaction can only enter once per kind.
INSERT INTO videobot_stars_ledger
 (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,
  buyer_user_id,stars,telegram_update_id)
VALUES ('ci_transaction_123','paid','ci_video_01:1','ci_video_01',44,77,300,55)
ON CONFLICT(telegram_transaction_id,kind) DO NOTHING;

DO $$
DECLARE
  n INTEGER;
  gross BIGINT;
  revisions INTEGER;
  free_ids BIGINT[];
BEGIN
  SELECT COUNT(*),COALESCE(SUM(stars),0) INTO n,gross
    FROM videobot_stars_ledger WHERE seller_user_id=44 AND kind='paid';
  IF n<>1 OR gross<>300 THEN
    RAISE EXCEPTION 'Stars transaction duplicate credited';
  END IF;
  SELECT free_message_ids INTO free_ids
    FROM videobot_post_receipts WHERE delivery_key='ci_video_01:1';
  IF free_ids<>ARRAY[101,102]::BIGINT[] THEN
    RAISE EXCEPTION 'Free media receipts not preserved';
  END IF;
  SELECT revision INTO revisions FROM videobot_creator_sessions
    WHERE owner_user_id=44;
  IF revisions<>1 THEN
    RAISE EXCEPTION 'Creator session revision not persisted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM videobot_listings
     WHERE listing_id='ci_video_01' AND status='published'
       AND rights_verified AND adult_consent_verified) THEN
    RAISE EXCEPTION 'Published listing constraints not persisted';
  END IF;
END $$;
-- Regression: a listing cannot become published from a forged API response
-- without a matching, durable free-album + paid-media receipt row.
INSERT INTO videobot_listings
 (listing_id,seller_user_id,revision,title,price_stars,price_mode,
  thumbnail_file_id,sample_file_id,sample_duration_seconds,paid_video_file_id,
  rights_verified,adult_consent_verified,status)
VALUES
 ('ci_draft_02',44,1,'CI PUBLISH TEST',300,'preset',
  'photo_ci2','sample_ci2',30,'paid_ci2',TRUE,TRUE,'draft');

UPDATE videobot_listings AS l
 SET status='published',revision=l.revision+1,updated_at=NOW()
 WHERE l.seller_user_id=44 AND l.listing_id='ci_draft_02' AND l.revision=1
  AND l.status IN ('draft','ready') AND l.rights_verified=TRUE
  AND l.adult_consent_verified=TRUE
  AND EXISTS (
   SELECT 1 FROM videobot_post_receipts AS r
   WHERE r.delivery_key='ci_draft_02:1' AND r.listing_id=l.listing_id
    AND r.revision=1 AND r.status='sent'
    AND r.free_message_ids=ARRAY[201,202]::BIGINT[] AND r.paid_message_id=203
  );
DO $$
BEGIN
 IF (SELECT status FROM videobot_listings WHERE listing_id='ci_draft_02') <> 'draft'
 THEN RAISE EXCEPTION 'Published without durable media receipt'; END IF;
END $$;

INSERT INTO videobot_post_receipts
 (delivery_key,listing_id,revision,topic_id,status,free_message_ids,paid_message_id)
VALUES ('ci_draft_02:1','ci_draft_02',1,15,'sent',ARRAY[201,202]::BIGINT[],203);

UPDATE videobot_listings AS l
 SET status='published',revision=l.revision+1,updated_at=NOW()
 WHERE l.seller_user_id=44 AND l.listing_id='ci_draft_02' AND l.revision=1
  AND l.status IN ('draft','ready') AND l.rights_verified=TRUE
  AND l.adult_consent_verified=TRUE
  AND EXISTS (
   SELECT 1 FROM videobot_post_receipts AS r
   WHERE r.delivery_key='ci_draft_02:1' AND r.listing_id=l.listing_id
    AND r.revision=1 AND r.status='sent'
    AND r.free_message_ids=ARRAY[201,202]::BIGINT[] AND r.paid_message_id=203
  );
DO $$
BEGIN
 IF (SELECT status FROM videobot_listings WHERE listing_id='ci_draft_02') <> 'published'
 THEN RAISE EXCEPTION 'Valid durable media receipt rejected'; END IF;
END $$;

ROLLBACK;
