-- Closes the remaining anon-executable gaps found by auditing pg_proc.proacl after
-- 20260806230100. Both were missed by 20260703160000_lock_secdef_function_execute
-- because they did not exist (or were not listed) when it ran.
--
-- atomic_complete_user_approval: SECURITY DEFINER and executable by PUBLIC/anon. It
-- promotes a pending_users row into a full profile (employee number, department,
-- designation, contact details), so anonymous EXECUTE is a real privilege-escalation
-- path even though the /api/admin/approve-user route itself is admin-gated. That route
-- builds its client strictly from SUPABASE_SERVICE_ROLE_KEY and hard-fails without it,
-- so there is no authenticated fallback to preserve — Group A treatment
-- (service_role only).
--
-- reassign_asset: executable by PUBLIC/anon but SECURITY INVOKER, so the body runs as
-- the caller and anon holds no RLS grants on assets/asset_assignments — not an
-- escalation path, tightened for hygiene. Its callers use
-- getServiceRoleClientOrFallback, so authenticated is retained (Group B), matching how
-- release_asset is already granted.
--
-- Audit query worth re-running after ANY migration that creates functions, since
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default and anon inherits it:
--
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (p.proacl is null or p.proacl::text like '%anon=X%');
--
-- Do NOT blanket-revoke: RLS policy-predicate helpers (has_role, is_admin_like,
-- is_lead_for_department, weekly_report_can_mutate, …) require anon/authenticated
-- EXECUTE. See the notes in 20260703160000.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'atomic_complete_user_approval'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reassign_asset'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end
$$;
