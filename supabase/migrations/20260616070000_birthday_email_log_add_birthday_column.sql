-- Fix: birthday_email_log dedup must account for the birthday value used at send time.
--
-- Root cause: if an employee's birthday field is corrected after the cron already
-- fired (e.g. changed from 06-02 → 06-16), the existing UNIQUE(user_id, sent_year)
-- constraint marks them as "already sent this year" and skips them on their real
-- birthday.
--
-- Fix: add a `birthday` column (MM-DD) that records which birthday value the email
-- was sent for.  Replace the unique constraint so the dedup key becomes
-- (user_id, sent_year, birthday).  That way:
--   • Normal case: one email per (employee, year, birthday) — duplicates still blocked.
--   • Corrected birthday: old log row has birthday='06-02', new birthday='06-16', so
--     the employee is NOT skipped on their real birthday.

-- 1. Add the column (nullable initially so the existing row doesn't break).
ALTER TABLE birthday_email_log
  ADD COLUMN IF NOT EXISTS birthday TEXT;

-- 2. Back-fill the existing row(s) with a sentinel so we can later make it NOT NULL.
--    We use 'unknown' as a fallback; these rows are historical and the email was
--    already delivered, so they will still block duplicate sends for the same
--    (user_id, sent_year, birthday='unknown') key.
UPDATE birthday_email_log
  SET birthday = 'unknown'
  WHERE birthday IS NULL;

-- 3. Tighten to NOT NULL now that every row has a value.
ALTER TABLE birthday_email_log
  ALTER COLUMN birthday SET NOT NULL;

-- 4. Drop the old two-column unique constraint and replace with a three-column one.
ALTER TABLE birthday_email_log
  DROP CONSTRAINT IF EXISTS birthday_email_log_user_id_sent_year_key;

ALTER TABLE birthday_email_log
  ADD CONSTRAINT birthday_email_log_user_id_sent_year_birthday_key
  UNIQUE (user_id, sent_year, birthday);

-- Add an index to support the dedup SELECT used in the edge function.
CREATE INDEX IF NOT EXISTS idx_birthday_email_log_dedup
  ON birthday_email_log (sent_year, birthday);
