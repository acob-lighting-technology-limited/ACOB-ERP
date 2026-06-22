-- Backfill: rename half_day status to late in attendance_records
UPDATE attendance_records
  SET status = 'late'
  WHERE status = 'half_day';
