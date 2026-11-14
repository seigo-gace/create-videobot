-- A legacy (pre-policy) database with one historical transaction.
-- Migration 005 must refuse to retroactively charge that past purchase.
INSERT INTO videobot_listings
 (listing_id,seller_user_id,revision,title,price_stars,price_mode,
  thumbnail_file_id,sample_file_id,sample_duration_seconds,paid_video_file_id,
  rights_verified,adult_consent_verified,status)
VALUES
 ('legacy_video',44,2,'PRE-POLICY HISTORICAL PURCHASE',300,'preset',
  'photo_legacy','sample_legacy',30,'paid_legacy',TRUE,TRUE,'published');

INSERT INTO videobot_post_receipts
 (delivery_key,listing_id,revision,topic_id,status,free_message_ids,paid_message_id)
VALUES ('legacy_video:1','legacy_video',1,15,'sent',ARRAY[101,102]::BIGINT[],103);

INSERT INTO videobot_stars_ledger
 (telegram_transaction_id,kind,delivery_key,listing_id,seller_user_id,buyer_user_id,stars,telegram_update_id)
VALUES ('legacy_tx_001','paid','legacy_video:1','legacy_video',44,77,300,10);
