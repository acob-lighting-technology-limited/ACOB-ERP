-- Remove hikvision_employee_id — mapping is derived from employee_id suffix instead
ALTER TABLE profiles DROP COLUMN IF EXISTS hikvision_employee_id;
