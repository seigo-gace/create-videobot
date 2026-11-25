-- Durable owner-ordered DM inbox for the single CreatorBot poller.
-- Telegram payment updates are processed on their existing synchronous path.
-- No new bot, no second getUpdates reader, no unguarded retry of effects.
CREATE TABLE IF NOT EXISTS videobot_owner_update_jobs (
  update_id BIGINT PRIMARY KEY CHECK(update_id >= 0),
  owner_id BIGINT NOT NULL CHECK(owner_id > 0),
  job_kind TEXT NOT NULL CHECK(job_kind IN ('heavy','normal')),
  payload_sha256 CHAR(64) NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload) = 'object'),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','completed','needs_reconcile')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS videobot_owner_update_jobs_pending
  ON videobot_owner_update_jobs(update_id) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS videobot_owner_update_jobs_owner_active
  ON videobot_owner_update_jobs(owner_id,update_id)
  WHERE status IN ('queued','running','needs_reconcile');
