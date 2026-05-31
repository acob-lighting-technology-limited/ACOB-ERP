DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'employment_status'
      AND e.enumlabel = 'separated'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'employment_status'
      AND e.enumlabel = 'exited'
  ) THEN
    ALTER TYPE public.employment_status RENAME VALUE 'separated' TO 'exited';
  END IF;
END $$;

UPDATE public.profiles
SET
  employment_status = 'exited'::public.employment_status,
  role = 'visitor',
  is_admin = false,
  is_department_lead = false,
  lead_departments = ARRAY[]::text[],
  admin_domains = ARRAY[]::text[],
  status_changed_at = COALESCE(status_changed_at, NOW())
WHERE employment_status::text IN ('separated', 'exited');

COMMENT ON COLUMN public.profiles.employment_status IS
  'Current employment status: active, suspended, exited, or on_leave';

COMMENT ON COLUMN public.profiles.separation_date IS
  'Date employee exited the organisation (if exited)';

COMMENT ON COLUMN public.profiles.separation_reason IS
  'Reason for employee exit (if exited)';
