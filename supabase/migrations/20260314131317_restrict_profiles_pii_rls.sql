-- =============================================================================
-- Migration: Restrict profiles SELECT RLS to prevent PII over-exposure
-- Date: 2026-03-14
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop all existing SELECT policies on profiles
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND cmd        = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Helper: check if current user is admin-like (no enum cast needed)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin_like()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role::text IN ('admin', 'super_admin', 'developer')
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Helper: check if current user leads a given department
--    Department leads have non-empty lead_departments arrays
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_lead_for_department(p_department TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND array_length(lead_departments, 1) > 0
      AND p_department = ANY(lead_departments)
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. Scoped SELECT policies
-- ---------------------------------------------------------------------------

-- Policy A: Users can always read their own full profile
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Policy B: Admins, super_admins, developers can read all profiles
CREATE POLICY "profiles_select_admin"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_admin_like());

-- Policy C: Department leads can read profiles in their departments
CREATE POLICY "profiles_select_lead_department"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    department IS NOT NULL
    AND public.is_lead_for_department(department)
  );

-- ---------------------------------------------------------------------------
-- 5. Non-PII employee directory VIEW for general lookups
--    Regular employees use this view instead of direct table access
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.employee_directory AS
SELECT
  id,
  first_name,
  last_name,
  full_name,
  company_email,
  department,
  department_id,
  company_role,
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
   profile owner, admins, super_admins, developers, and department leads.';;
