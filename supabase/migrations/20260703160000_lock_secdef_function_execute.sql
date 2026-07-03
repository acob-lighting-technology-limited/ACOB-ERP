-- Third remediation batch: remove the anonymous attack surface on SECURITY DEFINER
-- functions. Postgres grants EXECUTE to PUBLIC by default, which the anon role
-- inherits, so ~30 privileged functions were callable by anonymous internet users.
--
-- Strategy (verified against actual app callers via grep of app/ lib/ components/):
--   * GROUP A — no app caller (orphaned) or invoked only by cron / the service role
--     / internally by other SECURITY DEFINER functions: revoke from anon, authenticated
--     AND public; keep service_role (edge functions / server routes).
--   * GROUP B — invoked by the app from server routes and/or authenticated browser
--     clients: revoke from anon and public; keep authenticated + service_role.
--
-- service_role is granted EXPLICITLY on every function because it frequently relied
-- on the PUBLIC default we are revoking. Policy-predicate helpers (has_role,
-- is_admin_like, is_lead_for_department, current_user_lead_departments,
-- can_admin_project, is_project_member, weekly_report_can_mutate/lock_state, etc.)
-- are intentionally NOT touched — RLS depends on anon/authenticated executing them.

do $$
declare
  r record;
  group_a text[] := array[
    'complete_user_approval','update_system_setting','get_system_setting',
    'assign_asset','assign_device','generate_next_employee_number',
    'generate_correspondence_reference','get_starlink_dashboard_stats',
    'get_upcoming_starlink_payments','mark_all_notifications_read',
    'record_sync_completion','get_last_sync_timestamp','process_notification_queue',
    'process_notification_batch','process_digest_schedules','process_reminder_schedules',
    'broadcast_event_notification','create_starlink_payment_reminders',
    'update_overdue_starlink_payments','check_and_lift_expired_suspensions',
    'enqueue_asset_notification_bundle'
  ];
  group_b text[] := array[
    'create_notification','log_audit','get_audit_logs_enriched',
    'release_asset','assign_department_lead'
  ];
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname = any(group_a) or p.proname = any(group_b))
  loop
    execute format('revoke execute on function public.%I(%s) from anon, public', r.proname, r.args);
    if r.proname = any(group_a) then
      execute format('revoke execute on function public.%I(%s) from authenticated', r.proname, r.args);
    else
      execute format('grant execute on function public.%I(%s) to authenticated', r.proname, r.args);
    end if;
    execute format('grant execute on function public.%I(%s) to service_role', r.proname, r.args);
  end loop;
end $$;

-- FOLLOW-UP (not done here): get_audit_logs_enriched, assign_department_lead and
-- release_asset are now blocked for anon but remain callable by any authenticated
-- user. They rely on app-layer gating and should get an internal role check
-- (e.g. is_admin_like() / has_role('admin')) in a later change.
