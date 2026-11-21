-- Isolated PostgreSQL16 admission/dedup smoke. This is not a Telegram call.
BEGIN;
INSERT INTO videobot_webhook_updates
 (update_id,payload_sha256,status)
VALUES (901,repeat('a',64),'processing');
INSERT INTO videobot_webhook_updates
 (update_id,payload_sha256,status)
VALUES (901,repeat('a',64),'processing')
ON CONFLICT(update_id) DO NOTHING;
UPDATE videobot_webhook_updates
 SET status='completed',handled=true,updated_at=NOW()
 WHERE update_id=901 AND status='processing' AND handled IS NULL;
INSERT INTO videobot_webhook_updates
 (update_id,payload_sha256,status)
VALUES (902,repeat('b',64),'processing');
UPDATE videobot_webhook_updates
 SET status='needs_reconcile',updated_at=NOW()
 WHERE update_id=902 AND status='processing';
DO $$
DECLARE
 completed_count INTEGER;
 unknown_count INTEGER;
BEGIN
 SELECT COUNT(*) INTO completed_count FROM videobot_webhook_updates
 WHERE update_id=901 AND status='completed' AND handled=TRUE
   AND payload_sha256=repeat('a',64);
 SELECT COUNT(*) INTO unknown_count FROM videobot_webhook_updates
 WHERE update_id=902 AND status='needs_reconcile' AND handled IS NULL;
 IF completed_count<>1 OR unknown_count<>1 THEN
  RAISE EXCEPTION 'Telegram webhook idempotence schema regression';
 END IF;
END $$;
ROLLBACK;
