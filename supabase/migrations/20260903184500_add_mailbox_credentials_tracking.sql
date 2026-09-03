-- Migration: Add mailbox_credentials_sent_at to profiles and update atomic_complete_user_approval
-- Description: Tracks whether an employee's cPanel webmail credentials have been dispatched.

BEGIN;

-- 1. Add mailbox_credentials_sent_at to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS mailbox_credentials_sent_at timestamp with time zone DEFAULT NULL;

-- 2. Backfill existing active employees who were onboarded before today
UPDATE public.profiles
SET mailbox_credentials_sent_at = created_at
WHERE employment_status = 'active'
  AND created_at < '2026-09-03T00:00:00Z';

-- 3. Update atomic_complete_user_approval to initialize mailbox_credentials_sent_at as NULL
CREATE OR REPLACE FUNCTION public.atomic_complete_user_approval(
  p_auth_user_id uuid,
  p_pending_user_id uuid,
  p_employee_number text,
  p_first_name text,
  p_last_name text,
  p_other_names text,
  p_department text,
  p_designation text,
  p_company_email text,
  p_personal_email text,
  p_phone_number text,
  p_additional_phone text,
  p_residential_address text,
  p_office_location text,
  p_employment_date date,
  p_birthday text DEFAULT NULL::text,
  p_birth_year smallint DEFAULT NULL::smallint,
  p_employment_type text DEFAULT 'full_time'::text,
  p_contract_category_id uuid DEFAULT NULL::uuid,
  p_gender text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_department_id uuid;
  v_gender text;
BEGIN
  SELECT d.id
  INTO v_department_id
  FROM public.departments d
  WHERE lower(trim(d.name)) = lower(trim(p_department))
  LIMIT 1;

  v_gender := lower(nullif(trim(coalesce(p_gender, '')), ''));
  IF v_gender NOT IN ('male', 'female') THEN
    v_gender := NULL;
  END IF;

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
    birthday,
    birth_year,
    employment_type,
    contract_category_id,
    gender,
    updated_at,
    setup_token,
    setup_token_expires_at,
    must_reset_password,
    mailbox_credentials_sent_at
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
    p_birthday,
    p_birth_year,
    p_employment_type,
    p_contract_category_id,
    v_gender,
    now(),
    NULL,
    NULL,
    false,
    NULL
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
    birthday               = COALESCE(EXCLUDED.birthday, public.profiles.birthday),
    birth_year             = COALESCE(EXCLUDED.birth_year, public.profiles.birth_year),
    employment_type        = EXCLUDED.employment_type,
    contract_category_id   = EXCLUDED.contract_category_id,
    gender                 = COALESCE(EXCLUDED.gender, public.profiles.gender),
    updated_at             = now(),
    setup_token            = NULL,
    setup_token_expires_at = NULL,
    must_reset_password    = false,
    mailbox_credentials_sent_at = NULL;

  DELETE FROM public.pending_users WHERE id = p_pending_user_id;
END;
$function$;

COMMIT;
