-- Migration: Employment Types & Category-Based Employee IDs
-- Created: 2026-07-03

-- 1. Create contract_categories table
CREATE TABLE IF NOT EXISTS public.contract_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    code text NOT NULL UNIQUE CHECK (code = upper(code)),
    is_active boolean NOT NULL DEFAULT true,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on contract_categories
ALTER TABLE public.contract_categories ENABLE ROW LEVEL SECURITY;

-- Select policy: authenticated can read
CREATE POLICY "contract_categories_read_policy" ON public.contract_categories
    FOR SELECT TO authenticated USING (true);

-- 2. Create staff_id_counters table
CREATE TABLE IF NOT EXISTS public.staff_id_counters (
    code text PRIMARY KEY,
    last_no int NOT NULL DEFAULT 0
);

-- Enable RLS on staff_id_counters (fully locked from direct REST/client access)
ALTER TABLE public.staff_id_counters ENABLE ROW LEVEL SECURITY;

-- 3. Create employee_number_history table
CREATE TABLE IF NOT EXISTS public.employee_number_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    old_number text NOT NULL,
    old_employment_type text NOT NULL,
    reason text,
    changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on employee_number_history
ALTER TABLE public.employee_number_history ENABLE ROW LEVEL SECURITY;

-- Select policy: authenticated can read history
CREATE POLICY "employee_number_history_read_policy" ON public.employee_number_history
    FOR SELECT TO authenticated USING (true);

-- 4. Alter profiles table
ALTER TABLE public.profiles 
    ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract')),
    ADD COLUMN IF NOT EXISTS contract_category_id uuid REFERENCES public.contract_categories(id) ON DELETE SET NULL;

-- 5. Seed contract categories
INSERT INTO public.contract_categories (name, code, sort_order) VALUES
    ('SIWES', 'SIWES', 1),
    ('NYSC', 'NYSC', 2),
    ('Next-Gen', 'NEXTGEN', 3)
ON CONFLICT (code) DO NOTHING;

-- 6. Helper function to generate staff numbers
CREATE OR REPLACE FUNCTION public.generate_staff_number(
    p_type text,
    p_category_code text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
    v_year int;
    v_last_no int;
    v_new_no text;
BEGIN
    -- Validate type
    IF p_type NOT IN ('full_time', 'part_time', 'contract') THEN
        RAISE EXCEPTION 'Invalid employment type: %', p_type;
    END IF;

    IF p_type = 'full_time' THEN
        RETURN public.next_employee_number();
    END IF;

    -- Determine code prefix
    IF p_type = 'part_time' THEN
        v_code := 'PT';
    ELSE
        IF p_category_code IS NULL OR trim(p_category_code) = '' THEN
            RAISE EXCEPTION 'Category code is required for contract employment type';
        END IF;
        v_code := upper(trim(p_category_code));
    END IF;

    v_year := EXTRACT(YEAR FROM now())::int;

    -- Atomically increment last_no for the category code
    INSERT INTO public.staff_id_counters (code, last_no)
    VALUES (v_code, 1)
    ON CONFLICT (code) DO UPDATE
    SET last_no = public.staff_id_counters.last_no + 1
    RETURNING last_no INTO v_last_no;

    -- Format ID: ACOB/{code}/{year}/{NNN}
    v_new_no := format('ACOB/%s/%s/%s',
        v_code,
        v_year,
        LPAD(v_last_no::text, 3, '0')
    );

    RETURN v_new_no;
END;
$$;

-- Security hardening: revoke public execution and grant to service_role only
REVOKE EXECUTE ON FUNCTION public.generate_staff_number(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_staff_number(text, text) TO service_role;

-- 7. Amend prevent_employee_number_mutation to respect bypass config
CREATE OR REPLACE FUNCTION public.prevent_employee_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF old.employee_number IS NOT NULL AND new.employee_number IS DISTINCT FROM old.employee_number THEN
    IF current_setting('app.allow_employee_number_change', true) = 'on' THEN
      -- Allow the mutation during conversions
    ELSE
      RAISE EXCEPTION 'Employee number is immutable once set';
    END IF;
  END IF;

  RETURN new;
END;
$$;

-- 8. Conversion database function
CREATE OR REPLACE FUNCTION public.convert_employment_type(
    p_profile_id uuid,
    p_new_type text,
    p_new_category_code text,
    p_actor uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_number text;
    v_old_type text;
    v_new_number text;
    v_category_id uuid;
BEGIN
    -- Get current info
    SELECT employee_number, employment_type
    INTO v_old_number, v_old_type
    FROM public.profiles
    WHERE id = p_profile_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found';
    END IF;

    -- Validate new type
    IF p_new_type NOT IN ('full_time', 'part_time', 'contract') THEN
        RAISE EXCEPTION 'Invalid employment type: %', p_new_type;
    END IF;

    -- Resolve category ID if contract
    IF p_new_type = 'contract' THEN
        IF p_new_category_code IS NULL OR trim(p_new_category_code) = '' THEN
            RAISE EXCEPTION 'Category code is required for contract type';
        END IF;

        SELECT id INTO v_category_id
        FROM public.contract_categories
        WHERE code = upper(trim(p_new_category_code)) AND is_active = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Active contract category not found for code: %', p_new_category_code;
        END IF;
    ELSE
        v_category_id := NULL;
    END IF;

    -- Generate new number
    v_new_number := public.generate_staff_number(p_new_type, p_new_category_code);

    -- Log to history
    INSERT INTO public.employee_number_history (
        profile_id,
        old_number,
        old_employment_type,
        reason,
        changed_by
    )
    VALUES (
        p_profile_id,
        COALESCE(v_old_number, 'N/A'),
        COALESCE(v_old_type, 'full_time'),
        format('Conversion from %s to %s', COALESCE(v_old_type, 'full_time'), p_new_type),
        p_actor
    );

    -- Perform update by temporarily overriding employee number block
    PERFORM set_config('app.allow_employee_number_change', 'on', true);

    UPDATE public.profiles
    SET
        employee_number = v_new_number,
        employment_type = p_new_type,
        contract_category_id = v_category_id,
        updated_at = now()
    WHERE id = p_profile_id;

    RETURN v_new_number;
END;
$$;

-- Security hardening: revoke execution from PUBLIC, anon, authenticated; grant to service_role
REVOKE EXECUTE ON FUNCTION public.convert_employment_type(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.convert_employment_type(uuid, text, text, uuid) TO service_role;

-- 9. Recreate atomic_complete_user_approval with new parameters
DROP FUNCTION IF EXISTS public.atomic_complete_user_approval(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, text, smallint
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
  p_employment_date     date,
  p_birthday            text     DEFAULT NULL,
  p_birth_year          smallint DEFAULT NULL,
  p_employment_type     text     DEFAULT 'full_time',
  p_contract_category_id uuid    DEFAULT NULL
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
    birthday,
    birth_year,
    employment_type,
    contract_category_id,
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
    p_birthday,
    p_birth_year,
    p_employment_type,
    p_contract_category_id,
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
    birthday               = COALESCE(EXCLUDED.birthday, public.profiles.birthday),
    birth_year             = COALESCE(EXCLUDED.birth_year, public.profiles.birth_year),
    employment_type        = EXCLUDED.employment_type,
    contract_category_id   = EXCLUDED.contract_category_id,
    updated_at             = now(),
    setup_token            = NULL,
    setup_token_expires_at = NULL,
    must_reset_password    = false;

  DELETE FROM public.pending_users WHERE id = p_pending_user_id;
END;
$$;

COMMENT ON FUNCTION public.atomic_complete_user_approval IS
  'Atomically upserts approved employee profile (incl. birthday/birth_year, employment_type, contract_category_id), resolves department_id from department name, and removes pending user.';

-- Security hardening
REVOKE EXECUTE ON FUNCTION public.atomic_complete_user_approval(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, text, smallint, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.atomic_complete_user_approval(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text, text, text, date, text, smallint, text, uuid
) TO service_role;
