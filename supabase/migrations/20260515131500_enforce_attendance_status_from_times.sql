-- Enforce canonical attendance status from clock-in/clock-out at the database layer.
-- Rules:
-- - no clock_in and no clock_out => absent
-- - clock_in only => incomplete
-- - clock_in + clock_out => present/late based on 8:20 AM cutoff
-- - clock_out only => incomplete (invalid/incomplete capture)

CREATE OR REPLACE FUNCTION public.derive_attendance_status(
  p_clock_in time,
  p_clock_out time
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_clock_in IS NULL AND p_clock_out IS NULL THEN
    RETURN 'absent';
  END IF;

  IF p_clock_in IS NOT NULL AND p_clock_out IS NULL THEN
    RETURN 'incomplete';
  END IF;

  IF p_clock_in IS NULL AND p_clock_out IS NOT NULL THEN
    RETURN 'incomplete';
  END IF;

  IF p_clock_in > TIME '08:20:00' THEN
    RETURN 'late';
  END IF;

  RETURN 'present';
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_attendance_record_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Preserve explicit half-day marks.
  IF NEW.status = 'half_day' THEN
    RETURN NEW;
  END IF;

  NEW.status := public.derive_attendance_status(NEW.clock_in, NEW.clock_out);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_records_normalize_status ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_normalize_status
BEFORE INSERT OR UPDATE OF clock_in, clock_out, status
ON public.attendance_records
FOR EACH ROW
EXECUTE FUNCTION public.normalize_attendance_record_status();

-- Backfill existing rows to repair inconsistent status values.
UPDATE public.attendance_records
SET status = public.derive_attendance_status(clock_in, clock_out)
WHERE status IS DISTINCT FROM public.derive_attendance_status(clock_in, clock_out)
  AND status IS DISTINCT FROM 'half_day';
