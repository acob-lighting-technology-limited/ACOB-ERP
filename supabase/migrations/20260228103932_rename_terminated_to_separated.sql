-- Rename employment status value and profile separation fields to exit terminology

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'employment_status'
      AND e.enumlabel = 'terminated'
  ) THEN
    ALTER TYPE public.employment_status RENAME VALUE 'terminated' TO 'exited';
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'termination_date'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN termination_date TO separation_date;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'termination_reason'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN termination_reason TO separation_reason;
  END IF;
END$$;

COMMENT ON COLUMN public.profiles.employment_status IS
  'Current employment status: active, suspended, exited, or on_leave';

COMMENT ON COLUMN public.profiles.separation_date IS
  'Date employee exited the organisation (if exited)';

COMMENT ON COLUMN public.profiles.separation_reason IS
  'Reason for employee exit (if exited)';;
