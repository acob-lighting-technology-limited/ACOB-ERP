-- Add attendance exemption flag to profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS attendance_exempt BOOLEAN NOT NULL DEFAULT false;

-- Add waiver fields to attendance_records
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS waived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waiver_reason TEXT;
