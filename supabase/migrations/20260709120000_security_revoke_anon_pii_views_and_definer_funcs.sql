-- Security hotfix (Phase 1a + 1b)
--
-- 1a. The views employee_directory, profiles_public, kpi_achievement_summary are
--     SECURITY DEFINER-style views over `profiles`/`goals_objectives` and were
--     granted full DML to anon + authenticated. The anon key ships in the browser,
--     so this exposed 49/61/7 rows of employee PII + KPI data to the public internet
--     via /rest/v1/*. These views are NOT referenced anywhere in the app (the
--     directory reads `profiles` server-side). Revoke all non-service access.
--
-- 1b. 36 SECURITY DEFINER functions were EXECUTE-able by anon (and PUBLIC) via
--     /rest/v1/rpc/*, bypassing the app layer entirely. Revoke anon + PUBLIC on all.
--     Trigger-only functions also have authenticated revoked (triggers run as owner).
--     RLS-helper and genuine RPC functions keep authenticated EXECUTE.
--
-- Verify after apply (must return permission denied / 0 rows):
--   BEGIN; SET LOCAL ROLE anon;
--     SELECT * FROM employee_directory;              -- expect: permission denied
--     SELECT has_role('admin');                      -- expect: permission denied
--   ROLLBACK;

-- ---------------------------------------------------------------------------
-- 1a. Lock down the PII / KPI views
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.employee_directory       FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.profiles_public          FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.kpi_achievement_summary  FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------------------
-- 1b. Group A — trigger-only functions.
-- Invoked exclusively by table triggers (run as table owner), never via RPC.
-- Revoke from anon, authenticated AND PUBLIC.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.audit_asset_assignment_changes()      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_log_changes()                   FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cascade_department_rename()           FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cascade_office_location_rename()      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.correspondence_before_delete()        FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_single_department_lead()      FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_asset_issue_resolution()       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_asset_return()                 FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_asset_status_change()          FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_asset_status_notifications()   FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_asset_assignment()         FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_asset_issue()              FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                     FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_outgoing_transfer()            FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_email_on_notification_insert() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_task_completed()               FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_token_generated()              FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_asset_delete()               FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_employee_number_mutation()    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_delete()             FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_user_lead_departments()          FROM anon, authenticated, PUBLIC;

-- ---------------------------------------------------------------------------
-- 1b. Group B — RLS-helper + read-helper + genuine RPC functions.
-- Evaluated inside RLS policies (as the invoking role) or called via .rpc() by
-- authenticated users. Revoke anon + PUBLIC only; keep authenticated EXECUTE.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.has_role(text)                                        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_like()                                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_lead_for_department(text)                          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.current_user_lead_departments()                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_admin_project(uuid)                               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_manage_project(uuid)                              FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_project_member(uuid, uuid)                         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.asset_notification_requester_kind(uuid)               FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_asset_notification_department_lead(text)      FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_asset_notification_escalation_recipient(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_asset_notification_recent_owner(uuid)         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.meeting_document_slot_is_empty(integer, integer, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_notification_read(uuid)                          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.weekly_report_can_mutate(integer, integer)            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.weekly_report_lock_state(integer, integer)            FROM anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- Harden the one profiles SELECT policy that targets role `public` (matches anon)
-- and calls current_user_lead_departments(). Scope it to authenticated so anon
-- never evaluates the (now-revoked) helper and never matches any profiles row.
-- ---------------------------------------------------------------------------
ALTER POLICY "Leads can view dept member profiles" ON public.profiles TO authenticated;
