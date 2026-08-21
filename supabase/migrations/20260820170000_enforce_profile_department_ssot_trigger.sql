-- Migration: Enforce Profile Department SSOT Trigger
-- Automatically synchronizes department (TEXT) <-> department_id (UUID)
-- and lead_departments (TEXT[]) <-> lead_department_ids (UUID[])
-- on public.profiles on every INSERT and UPDATE.

BEGIN;

-- Clean up any legacy non-lead profiles that have lingering lead_departments before trigger is bound
UPDATE public.profiles
SET lead_departments = '{}', lead_department_ids = '{}'
WHERE is_department_lead IS NOT TRUE
  AND (array_length(lead_departments, 1) > 0 OR array_length(lead_department_ids, 1) > 0);

CREATE OR REPLACE FUNCTION public.handle_profile_department_ssot_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
SECURITY DEFINER
AS $$
DECLARE
  v_norm_dept text;
  v_norm_leads text[];
BEGIN
  -- 1. Primary Department Synchronization
  IF NEW.department IS NOT NULL AND trim(NEW.department) <> '' THEN
    v_norm_dept := public.normalize_department_name(trim(NEW.department));
    NEW.department := v_norm_dept;
    NEW.department_id := (
      SELECT id FROM public.departments 
      WHERE name = v_norm_dept 
      LIMIT 1
    );
  ELSIF NEW.department_id IS NOT NULL THEN
    NEW.department := (
      SELECT name FROM public.departments 
      WHERE id = NEW.department_id 
      LIMIT 1
    );
  ELSE
    NEW.department := NULL;
    NEW.department_id := NULL;
  END IF;

  -- 2. Lead Departments Synchronization adhering to check_lead_has_departments
  IF NEW.is_department_lead IS NOT TRUE THEN
    NEW.lead_departments := '{}';
    NEW.lead_department_ids := '{}';
  ELSE
    -- User is a department lead
    IF NEW.lead_departments IS NOT NULL AND array_length(NEW.lead_departments, 1) > 0 THEN
      SELECT array_agg(DISTINCT public.normalize_department_name(trim(elem)))
      INTO v_norm_leads
      FROM unnest(NEW.lead_departments) AS elem
      WHERE elem IS NOT NULL AND trim(elem) <> '';
    ELSIF NEW.lead_department_ids IS NOT NULL AND array_length(NEW.lead_department_ids, 1) > 0 THEN
      SELECT array_agg(DISTINCT name ORDER BY name)
      INTO v_norm_leads
      FROM public.departments
      WHERE id = ANY(NEW.lead_department_ids);
    ELSIF NEW.department IS NOT NULL THEN
      v_norm_leads := ARRAY[NEW.department];
    ELSE
      v_norm_leads := '{}';
    END IF;

    NEW.lead_departments := v_norm_leads;
    NEW.lead_department_ids := (
      SELECT array_agg(id ORDER BY name)
      FROM public.departments
      WHERE name = ANY(v_norm_leads)
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Revoke execute from public/anon and grant to authenticated/service_role
REVOKE EXECUTE ON FUNCTION public.handle_profile_department_ssot_sync() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_profile_department_ssot_sync() TO authenticated, service_role;

-- Drop trigger if already exists
DROP TRIGGER IF EXISTS trg_profile_department_ssot_sync ON public.profiles;

-- Create BEFORE INSERT OR UPDATE trigger
CREATE TRIGGER trg_profile_department_ssot_sync
BEFORE INSERT OR UPDATE OF department, department_id, lead_departments, lead_department_ids, is_department_lead
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.handle_profile_department_ssot_sync();

-- Run backfill on profiles to ensure all existing rows are 100% normalized and synced
UPDATE public.profiles
SET department = department
WHERE department IS NOT NULL;

COMMIT;
