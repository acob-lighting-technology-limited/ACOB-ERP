-- Migration: Safe backfill of approved/commented on-time incomplete records to IWP

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

UPDATE public.attendance_appeals a
SET requested_status = 'incomplete_with_permission'
FROM public.attendance_records r
WHERE a.attendance_record_id = r.id
  AND r.status = 'incomplete_with_permission'
  AND a.requested_status = 'lateness_with_permission';
