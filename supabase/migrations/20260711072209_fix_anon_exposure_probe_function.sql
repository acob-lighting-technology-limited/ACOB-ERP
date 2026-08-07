-- Imported from the acob-erp remote migration ledger (version 20260711072209).
-- Originally applied via the Supabase dashboard/MCP rather than through this repo;
-- captured here so the repository can reproduce production. Already applied — do not
-- re-run against a database that has it.

CREATE OR REPLACE FUNCTION public.security_probe_anon_exposure()
RETURNS TABLE (
  finding_type text,
  object_schema text,
  object_name text,
  detail text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  select
    'rls_disabled'::text,
    n.nspname,
    c.relname,
    'RLS is not enabled on this table'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity

  union all

  select
    'permissive_policy'::text,
    schemaname,
    tablename,
    policyname || ' (' || cmd || ') roles=' || roles::text ||
      case when qual is not null then ' qual=' || qual else '' end
  from pg_policies
  where schemaname = 'public'
    and permissive = 'PERMISSIVE'
    and (roles::text like '%anon%' or roles::text like '%public%')

  union all

  select distinct
    'anon_executable_definer_function'::text,
    n.nspname,
    p.proname,
    'EXECUTE granted to anon/PUBLIC on SECURITY DEFINER function'::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and p.prosecdef
    and acl.privilege_type = 'EXECUTE'
    and (acl.grantee = 0 or r.rolname = 'anon')

  union all

  select
    'anon_readable_definer_view'::text,
    n.nspname,
    c.relname,
    'anon can SELECT and view does not set security_invoker=true'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and has_table_privilege('anon', c.oid, 'SELECT')
    and coalesce((c.reloptions::text like '%security_invoker=true%'), false) = false
$$;

REVOKE ALL ON FUNCTION public.security_probe_anon_exposure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_probe_anon_exposure() TO service_role;
