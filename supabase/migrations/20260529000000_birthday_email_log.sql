-- Tracks birthday emails already sent so the daily cron never sends a duplicate
-- to the same employee within the same calendar year.
CREATE TABLE IF NOT EXISTS birthday_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sent_year INTEGER NOT NULL,
  recipient TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sent_year)
);

ALTER TABLE birthday_email_log ENABLE ROW LEVEL SECURITY;

-- Only the service role (used by the cron route) reads/writes this table.
-- No public policies are added, so anon/auth clients have no access by default.
