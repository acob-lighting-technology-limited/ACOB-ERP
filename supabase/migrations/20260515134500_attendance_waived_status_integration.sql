-- Integrate waiver as a first-class attendance status.
-- When waived=true, status must be 'waived' (except explicit half_day preservation).

CREATE OR REPLACE FUNCTION public.normalize_attendance_record_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Preserve explicit half-day marks.
  IF NEW.status = 'half_day' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.waived, false) THEN
    NEW.status := 'waived';
    RETURN NEW;
  END IF;

  NEW.status := public.derive_attendance_status(NEW.clock_in, NEW.clock_out);
  RETURN NEW;
END;
$$;

-- Backfill rows where waiver is enabled so status reflects waived.
UPDATE public.attendance_records
SET status = 'waived'
WHERE COALESCE(waived, false) = true
  AND status IS DISTINCT FROM 'waived'
  AND status IS DISTINCT FROM 'half_day';
