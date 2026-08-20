-- Migration: Update normalize_attendance_record_status trigger function for IWP & run safe backfill

-- 1. Drop trigger temporarily so column/function can be updated cleanly
DROP TRIGGER IF EXISTS trg_attendance_records_normalize_status ON public.attendance_records;

-- 2. Update trigger function to preserve 'incomplete_with_permission'
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

  -- Preserve manual permission statuses including IWP
  IF NEW.status IN ('lateness_with_permission', 'incomplete_with_permission', 'absent_with_permission', 'out_of_station', 'on_leave', 'exempted', 'waiver') THEN
    RETURN NEW;
  END IF;

  NEW.status := public.derive_attendance_status(NEW.clock_in, NEW.clock_out);
  RETURN NEW;
END;
$$;

-- 3. Re-create trigger
CREATE TRIGGER trg_attendance_records_normalize_status
  BEFORE INSERT OR UPDATE OF clock_in, clock_out, status
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_attendance_record_status();

-- 4. Execute backfill for approved/commented on-time incomplete records
UPDATE public.attendance_records
SET status = 'incomplete_with_permission'
WHERE (status = 'incomplete' OR status = 'lateness_with_permission')
  AND clock_out IS NULL
  AND clock_in IS NOT NULL
  AND clock_in <= '08:20:00'
  AND (
    (manual_comment IS NOT NULL AND manual_comment <> '' AND manual_comment <> 'None')
    OR id IN (
      SELECT attendance_record_id 
      FROM public.attendance_appeals 
      WHERE status = 'approved' AND attendance_record_id IS NOT NULL
    )
  );

-- 5. Sync attendance_appeals requested_status
UPDATE public.attendance_appeals a
SET requested_status = 'incomplete_with_permission'
FROM public.attendance_records r
WHERE a.attendance_record_id = r.id
  AND r.status = 'incomplete_with_permission'
  AND a.requested_status = 'lateness_with_permission';
