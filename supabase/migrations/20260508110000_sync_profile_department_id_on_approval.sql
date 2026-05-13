-- Ensure approved users are linked to departments by both name and department_id.
-- Fixes employee edit form department preselect + department member counts.

DROP FUNCTION IF EXISTS public.atomic_complete_user_approval(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  date
);

CREATE OR REPLACE FUNCTION public.atomic_complete_user_approval(
  p_auth_user_id        uuid,
  p_pending_user_id     uuid,
  p_employee_number     text,
  p_first_name          text,
  p_last_name           text,
  p_other_names         text,
  p_department          text,
  p_designation         text,
  p_company_email       text,
  p_personal_email      text,
  p_phone_number        text,
  p_additional_phone    text,
  p_residential_address text,
  p_office_location     text,
  p_employment_date     date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_department_id uuid;
BEGIN
  -- Resolve department_id from provided department name.
  SELECT d.id
  INTO v_department_id
  FROM public.departments d
  WHERE lower(trim(d.name)) = lower(trim(p_department))
  LIMIT 1;

  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    other_names,
    department,
    department_id,
    designation,
    role,
    employment_status,
    employee_number,
    company_email,
    personal_email,
    phone_number,
    additional_phone,
    residential_address,
    office_location,
    employment_date,
    updated_at,
    setup_token,
    setup_token_expires_at,
    must_reset_password
  )
  VALUES (
    p_auth_user_id,
    p_first_name,
    p_last_name,
    p_other_names,
    p_department,
    v_department_id,
    p_designation,
    'employee',
    'active',
    p_employee_number,
    p_company_email,
    p_personal_email,
    p_phone_number,
    p_additional_phone,
    p_residential_address,
    p_office_location,
    COALESCE(p_employment_date, CURRENT_DATE),
    now(),
    NULL,
    NULL,
    false
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name             = EXCLUDED.first_name,
    last_name              = EXCLUDED.last_name,
    other_names            = EXCLUDED.other_names,
    department             = EXCLUDED.department,
    department_id          = EXCLUDED.department_id,
    designation            = EXCLUDED.designation,
    role                   = 'employee',
    employment_status      = 'active',
    employee_number        = EXCLUDED.employee_number,
    company_email          = EXCLUDED.company_email,
    personal_email         = EXCLUDED.personal_email,
    phone_number           = EXCLUDED.phone_number,
    additional_phone       = EXCLUDED.additional_phone,
    residential_address    = EXCLUDED.residential_address,
    office_location        = EXCLUDED.office_location,
    employment_date        = EXCLUDED.employment_date,
    updated_at             = now(),
    setup_token            = NULL,
    setup_token_expires_at = NULL,
    must_reset_password    = false;

  DELETE FROM public.pending_users WHERE id = p_pending_user_id;
END;
$$;

-- Backfill existing employee profiles with missing department_id using department name.
UPDATE public.profiles p
SET department_id = d.id,
    updated_at = now()
FROM public.departments d
WHERE p.department_id IS NULL
  AND p.department IS NOT NULL
  AND lower(trim(p.department)) = lower(trim(d.name));

COMMENT ON FUNCTION public.atomic_complete_user_approval IS
  'Atomically upserts approved employee profile, resolves department_id from department name, and removes pending user.';
