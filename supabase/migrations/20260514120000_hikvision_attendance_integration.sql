-- Add source tracking to attendance_records
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual';

-- Add Hikvision device employee ID to profiles for device-to-employee mapping
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hikvision_employee_id VARCHAR(50) UNIQUE;
