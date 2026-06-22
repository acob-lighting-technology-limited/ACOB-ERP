-- Remove the hidden DB-side appeal auto-resolution. It is replaced by app-level logic
-- (lib/hr/attendance-appeals.ts -> resolvePendingAppealOnManualStatus) so every state
-- transition is observable on the attendance_events timeline and is testable. Defensive
-- drop covers any environment where the short-lived trigger was applied.

DROP TRIGGER IF EXISTS auto_resolve_appeal_on_record_update ON public.attendance_records;
DROP FUNCTION IF EXISTS public.tr_auto_resolve_attendance_appeal();
