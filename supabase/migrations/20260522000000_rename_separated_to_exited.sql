-- Rename employment_status enum value 'separated' → 'exited'
ALTER TYPE public.employment_status RENAME VALUE 'separated' TO 'exited';

-- Update column comments to reflect the new terminology
COMMENT ON COLUMN public.profiles.separation_date IS
  'Date employee exited the organisation (if exited)';

COMMENT ON COLUMN public.profiles.separation_reason IS
  'Reason for employee exit (if exited)';

-- Update the profiles table comment to reflect the current enum values
COMMENT ON COLUMN public.profiles.employment_status IS
  'Current employment status: active, suspended, exited, or on_leave';

-- Recreate the employee_directory view with updated filter so exited employees are excluded.
-- The previous version filtered on ''separated''; after the rename the value is ''exited''.
CREATE OR REPLACE VIEW public.employee_directory AS
SELECT
  id,
  first_name,
  last_name,
  full_name,
  company_email,
  department,
  department_id,
  designation,
  role,
  employment_status,
  office_location,
  lead_departments,
  employee_number,
  employment_date,
  is_admin,
  is_department_lead,
  admin_domains,
  email_notifications,
  created_at,
  updated_at
FROM public.profiles
WHERE employment_status::text NOT IN ('exited');

GRANT SELECT ON public.employee_directory TO authenticated;

COMMENT ON VIEW public.employee_directory IS
  'Non-PII employee directory. Excludes sensitive fields (bank account, phone, address, DOB).
   Use this for general employee lookups. Full profile data only accessible to:
   profile owner, admins, super_admins, developers, and department leads.';
