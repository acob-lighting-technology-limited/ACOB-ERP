DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'company_role'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN company_role TO designation;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'pending_users'
      AND column_name = 'company_role'
  ) THEN
    ALTER TABLE public.pending_users RENAME COLUMN company_role TO designation;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    company_email,
    first_name,
    last_name,
    other_names,
    department,
    designation,
    phone_number,
    additional_phone,
    residential_address,
    current_work_location,
    device_allocated,
    device_type,
    device_model,
    is_admin,
    created_at,
    updated_at
  ) VALUES (
    NEW.id,
    NEW.email,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    FALSE,
    NOW(),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
BEGIN
  INSERT INTO public.profiles (
    id,
    first_name,
    last_name,
    other_names,
    department,
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
    first_name            = EXCLUDED.first_name,
    last_name             = EXCLUDED.last_name,
    other_names           = EXCLUDED.other_names,
    department            = EXCLUDED.department,
    designation           = EXCLUDED.designation,
    role                  = 'employee',
    employment_status     = 'active',
    employee_number       = EXCLUDED.employee_number,
    company_email         = EXCLUDED.company_email,
    personal_email        = EXCLUDED.personal_email,
    phone_number          = EXCLUDED.phone_number,
    additional_phone      = EXCLUDED.additional_phone,
    residential_address   = EXCLUDED.residential_address,
    office_location       = EXCLUDED.office_location,
    employment_date       = EXCLUDED.employment_date,
    updated_at            = now(),
    setup_token           = NULL,
    setup_token_expires_at = NULL,
    must_reset_password   = false;

  DELETE FROM public.pending_users WHERE id = p_pending_user_id;
END;
$$;

COMMENT ON FUNCTION public.atomic_complete_user_approval IS
  'Atomically upserts the approved employee profile and removes the pending_users record in a single transaction.';

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

CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id,
  full_name,
  first_name,
  last_name,
  other_names,
  company_email,
  department,
  department_id,
  role,
  designation,
  job_description,
  is_department_lead,
  lead_departments,
  office_location,
  employment_status,
  employment_type,
  work_location,
  employee_number,
  employment_date,
  gender,
  is_admin,
  email_notifications,
  admin_domains,
  created_at,
  updated_at
FROM public.profiles;
