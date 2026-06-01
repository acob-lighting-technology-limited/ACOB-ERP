-- Per-punch source tracking for attendance records.
-- The single `source` column cannot express a record whose clock-in and clock-out
-- came from different origins (e.g. Hikvision clock-in + manual clock-out). Add a
-- source per punch so the UI can show Automated / Manual / Mixed accurately.

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS clock_in_source  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS clock_out_source VARCHAR(50);

-- Backfill from the legacy single `source` column: attribute it to whichever
-- punches exist on the row.
UPDATE public.attendance_records
SET clock_in_source = source
WHERE clock_in IS NOT NULL AND clock_in_source IS NULL;

UPDATE public.attendance_records
SET clock_out_source = source
WHERE clock_out IS NOT NULL AND clock_out_source IS NULL;
