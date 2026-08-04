-- Fix check constraint profiles_employee_number_format to support Part-Time (PT) and Contract (e.g. SIWES) patterns
ALTER TABLE profiles
DROP CONSTRAINT IF EXISTS profiles_employee_number_format;

ALTER TABLE profiles
ADD CONSTRAINT profiles_employee_number_format
CHECK (
  employee_number IS NULL OR
  employee_number ~ '^ACOB/([A-Z0-9-]+/)?[0-9]{4}/[0-9]{3}$'
);

COMMENT ON COLUMN profiles.employee_number IS 'Unique employee identifier in format: ACOB/{YEAR}/{SERIAL} or ACOB/{CATEGORY}/{YEAR}/{SERIAL}.';
