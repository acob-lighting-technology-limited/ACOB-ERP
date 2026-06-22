-- Alter status column length to 50 to accommodate 'lateness_with_permission' and 'absent_with_permission'
ALTER TABLE public.attendance_records ALTER COLUMN status TYPE character varying(50);

-- Update the status normalization trigger function to preserve manual status overrides
CREATE OR REPLACE FUNCTION public.normalize_attendance_record_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'half_day' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.waived, false) THEN
    NEW.status := 'waiver';
    RETURN NEW;
  END IF;

  -- Preserve manual statuses
  IF NEW.status IN ('lateness_with_permission', 'absent_with_permission', 'out_of_station', 'on_leave', 'exempted', 'waiver') THEN
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
