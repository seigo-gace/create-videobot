-- Forward-only schema extension; historical listings and receipts are untouched.
ALTER TABLE videobot_listings ADD COLUMN IF NOT EXISTS second_thumbnail_file_id TEXT NULL;
ALTER TABLE videobot_listings DROP CONSTRAINT IF EXISTS videobot_listings_sample_duration_seconds_check;
ALTER TABLE videobot_listings ADD CONSTRAINT videobot_listings_sample_duration_seconds_check CHECK(sample_duration_seconds > 0 AND sample_duration_seconds <= 60.1);
ALTER TABLE videobot_post_receipts DROP CONSTRAINT IF EXISTS videobot_post_receipts_free_message_ids_check;
ALTER TABLE videobot_post_receipts ADD CONSTRAINT videobot_post_receipts_free_message_ids_check CHECK(
 free_message_ids IS NULL OR (cardinality(free_message_ids) IN (2,3)
 AND free_message_ids[1]>0 AND free_message_ids[2]>0 AND free_message_ids[1]<>free_message_ids[2]
 AND (cardinality(free_message_ids)=2 OR (free_message_ids[3]>0 AND free_message_ids[3]<>free_message_ids[1] AND free_message_ids[3]<>free_message_ids[2])))
);
