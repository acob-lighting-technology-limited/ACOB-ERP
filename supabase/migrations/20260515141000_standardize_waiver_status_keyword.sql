-- Standardize attendance waiver status keyword to "waiver" only.
-- Keep boolean column name "waived" for compatibility, but status text uses "waiver".

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
    NEW.status := 'waiver';
    RETURN NEW;
  END IF;

  NEW.status := public.derive_attendance_status(NEW.clock_in, NEW.clock_out);
  RETURN NEW;
END;
$$;

-- Convert any legacy 'waived' statuses to 'waiver'.
UPDATE public.attendance_records
SET status = 'waiver'
WHERE status = 'waived';

-- Ensure all currently waived rows align to waiver status.
UPDATE public.attendance_records
SET status = 'waiver'
WHERE COALESCE(waived, false) = true
  AND status IS DISTINCT FROM 'waiver'
  AND status IS DISTINCT FROM 'half_day';
