-- Preserve the original upload file_unique_id independently from the
-- Telegram sticker file_unique_id returned after set creation. Telegram may
-- normalize an uploaded file when it becomes a sticker in a new pack.
-- Keep the receipt; never infer a successful existing-pack add from this.
ALTER TABLE videobot_sticker_registration_receipts
  ADD COLUMN IF NOT EXISTS uploaded_file_unique_id TEXT;
UPDATE videobot_sticker_registration_receipts
  SET uploaded_file_unique_id=file_unique_id
  WHERE uploaded_file_unique_id IS NULL AND file_unique_id IS NOT NULL;
