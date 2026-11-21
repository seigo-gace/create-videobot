-- Creator-video optional description, retained with the existing owner listing.
-- Does not touch sticker, GATE or payment schemas.
ALTER TABLE videobot_listings
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''
  CHECK (char_length(description) <= 800);
