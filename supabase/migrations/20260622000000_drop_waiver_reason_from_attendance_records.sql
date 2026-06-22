-- Backfill manual_comment from waiver_reason where manual_comment is null,
-- then drop the waiver_reason column. manual_comment is now the single
-- override-reason field for all manual attendance statuses.

UPDATE attendance_records
SET manual_comment = waiver_reason
WHERE manual_comment IS NULL
  AND waiver_reason IS NOT NULL;

ALTER TABLE attendance_records
  DROP COLUMN IF EXISTS waiver_reason;
