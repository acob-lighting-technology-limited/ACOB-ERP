-- Companion to 20260806230000_reconcile_prod_schema_drift.sql.
--
-- The functions that migration restores were created fresh, so they picked up
-- Postgres's default EXECUTE-to-PUBLIC grant, which the anon role inherits. That is
-- exactly the anonymous attack surface 20260703160000_lock_secdef_function_execute
-- was written to remove, so apply that migration's Group B treatment here: revoke
-- from PUBLIC and anon, keep authenticated + service_role.
--
-- authenticated is retained (rather than service_role only) because each caller uses
-- getServiceRoleClientOrFallback (lib/supabase/admin.ts) or an equivalent inline
-- fallback, which degrades to the user-scoped client when SUPABASE_SERVICE_ROLE_KEY
-- is absent.
--
-- Keep this migration adjacent to any future one that recreates these functions —
-- CREATE OR REPLACE preserves existing grants, but a DROP + CREATE resets them to
-- the PUBLIC default and silently reopens the hole.

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'atomic_leave_approve_transition',
        'atomic_leave_approve_final',
        'atomic_leave_reject',
        'atomic_assign_asset',
        'atomic_dispatch_correspondence'
      )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
  end loop;
end
$$;
