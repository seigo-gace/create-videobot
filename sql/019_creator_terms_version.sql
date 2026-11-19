-- Versioned creator agreement evidence for new paid-video products.
-- Existing purchases and historical consent remain untouched.
ALTER TABLE videobot_listings
  ADD COLUMN IF NOT EXISTS creator_terms_version TEXT NULL
    CHECK (creator_terms_version IS NULL OR char_length(creator_terms_version) BETWEEN 1 AND 32),
  ADD COLUMN IF NOT EXISTS creator_terms_url TEXT NULL
    CHECK (creator_terms_url IS NULL OR char_length(creator_terms_url) BETWEEN 1 AND 512);
