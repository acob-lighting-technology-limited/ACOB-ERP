-- Migration: Restore historical attendance records that were overwritten by device clock-out punches

-- 1. Restore Aug 13 rain records that were overwritten from LWP back to 'late'
UPDATE public.attendance_records
SET status = 'lateness_with_permission'
WHERE date = '2026-08-13'
  AND manual_comment = 'Rain'
  AND status = 'late';

-- 2. Restore other late records with approved manual comments ('Yes', 'Rain fall', 'Lateness', 'Due to health')
UPDATE public.attendance_records
SET status = 'lateness_with_permission'
WHERE status = 'late'
  AND manual_comment IN ('Yes', 'Rain fall', 'Lateness', 'Due to health');

-- 3. Restore field assignments that were overwritten to out_of_station
UPDATE public.attendance_records
SET status = 'out_of_station'
WHERE status IN ('late', 'incomplete')
  AND manual_comment IN ('FIeld Assignment', 'Field assignment in Maiduguri');
