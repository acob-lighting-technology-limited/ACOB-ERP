-- SECURITY DEFINER introspection function backing scripts/anon-security-probe.mjs.
-- Only callable by service_role; enumerates anon/PUBLIC exposure that RLS
-- grants alone can't show (permissive policies, SECURITY DEFINER functions,
-- SECURITY DEFINER/invoker=false views).
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
  -- Tables with RLS disabled entirely (anon inherits the blanket GRANT with no gate)
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

  -- Only flag policies that are genuinely open to anon: either 'anon' is an
  -- explicit role, or the policy applies to {public} with no session-bound
  -- gate at all (qual/with_check null or literally 'true'). Policies gated
  -- by auth.uid()/auth.role()/has_role() etc. are NOT anon-exposed, since
  -- those all evaluate false/null for the anon role.
  select
    'permissive_policy'::text,
    schemaname,
    tablename,
    policyname || ' (' || cmd || ') roles=' || roles::text ||
      case when qual is not null then ' qual=' || qual else '' end ||
      case when with_check is not null then ' with_check=' || with_check else '' end
  from pg_policies
  where schemaname = 'public'
    and permissive = 'PERMISSIVE'
    and (
      roles::text like '%anon%'
      or (
        roles::text = '{public}'
        and (qual is null or qual = 'true')
        and (with_check is null or with_check = 'true')
      )
    )

  union all

  -- SECURITY DEFINER functions still executable by anon or PUBLIC
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

  -- Views that are SECURITY DEFINER-style (not security_invoker) and anon-readable
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
