-- Migration: Safe backfill of on-time incomplete records with approved appeals or admin comments to IWP

-- 1. Convert ONLY on-time incomplete records that have an approved appeal OR explicit admin comment (e.g. Rafiat's edit)
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

-- 2. Update corresponding attendance_appeals where requested_status was lateness_with_permission for records updated above
UPDATE public.attendance_appeals a
SET requested_status = 'incomplete_with_permission'
FROM public.attendance_records r
WHERE a.attendance_record_id = r.id
  AND r.status = 'incomplete_with_permission'
  AND a.requested_status = 'lateness_with_permission';
