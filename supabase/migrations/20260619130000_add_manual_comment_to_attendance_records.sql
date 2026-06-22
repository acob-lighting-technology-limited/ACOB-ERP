-- Add manual_comment to attendance_records
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS manual_comment TEXT;
