-- Phase 1e — Pin search_path on functions flagged with a mutable search_path.
--
-- A mutable search_path in a SECURITY DEFINER / trigger function lets a caller
-- who can create objects in an earlier-resolved schema shadow the objects the
-- function references. Pinning to `public, pg_temp` closes this. Behaviour is
-- unchanged — all these functions already reference public objects.
-- (process_notification_queue / process_digest_schedules are pinned in
--  20260709122000_secrets_vault_only.sql.)

ALTER FUNCTION public.cascade_department_rename()                          SET search_path = public, pg_temp;
ALTER FUNCTION public.cascade_office_location_rename()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.compute_final_performance_score(numeric, numeric, numeric, numeric) SET search_path = public, pg_temp;
ALTER FUNCTION public.derive_attendance_status(time without time zone, time without time zone) SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_single_department_lead()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.meeting_docs_set_updated_at()                        SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_attendance_record_status()                 SET search_path = public, pg_temp;
ALTER FUNCTION public.process_reminder_schedules()                         SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_compute_final_score()                            SET search_path = public, pg_temp;
