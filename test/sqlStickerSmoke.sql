-- Real PostgreSQL sticker-persistence smoke, isolated CI database only.
BEGIN;
INSERT INTO videobot_sticker_packs
 (pack_name,owner_user_id,kind,title,format,is_default,telegram_verified_at)
VALUES ('s42_1234abcd_by_CreateVdobot',42,'regular','My Stickers','static',TRUE,NOW());
INSERT INTO videobot_sticker_registration_receipts
 (operation_id,owner_user_id,pack_name,source_file_id,kind)
VALUES ('s42_1234abcd',42,'s42_1234abcd_by_CreateVdobot','ci_source','regular');
UPDATE videobot_sticker_registration_receipts
 SET phase='uploaded',format='static',file_unique_id='ci_unique',updated_at=NOW()
 WHERE operation_id='s42_1234abcd' AND owner_user_id=42 AND phase='preparing';
UPDATE videobot_sticker_registration_receipts
 SET phase='submission_started',updated_at=NOW()
 WHERE operation_id='s42_1234abcd' AND owner_user_id=42 AND phase='uploaded';
INSERT INTO videobot_sticker_items
 (pack_name,file_unique_id,file_id,format,emoji,position,telegram_verified_at)
VALUES ('s42_1234abcd_by_CreateVdobot','ci_unique','ci_file','static','🙂',0,NOW());
UPDATE videobot_sticker_registration_receipts SET phase='registered'
 WHERE operation_id='s42_1234abcd' AND phase='submission_started';

DO $$
BEGIN
 IF (SELECT phase FROM videobot_sticker_registration_receipts
   WHERE operation_id='s42_1234abcd') <> 'registered'
 THEN RAISE EXCEPTION 'receipt not persisted'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM videobot_sticker_packs p
  JOIN videobot_sticker_items i ON i.pack_name=p.pack_name
  WHERE p.owner_user_id=42 AND p.kind='regular'
    AND i.file_unique_id='ci_unique' AND i.position=0)
 THEN RAISE EXCEPTION 'pack item readback mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM videobot_sticker_packs
   WHERE owner_user_id=99) THEN RAISE EXCEPTION 'foreign owner exposed'; END IF;
END $$;

-- The schema must reject a second active default pack of the same kind.
DO $$
BEGIN
 BEGIN
  INSERT INTO videobot_sticker_packs
   (pack_name,owner_user_id,kind,title,format,is_default,telegram_verified_at)
  VALUES ('s42_ffffabcd_by_CreateVdobot',42,'regular','Duplicate default','static',TRUE,NOW());
  RAISE EXCEPTION 'duplicate default unexpectedly allowed';
 EXCEPTION
  WHEN unique_violation THEN NULL;
 END;
END $$;
ROLLBACK;
