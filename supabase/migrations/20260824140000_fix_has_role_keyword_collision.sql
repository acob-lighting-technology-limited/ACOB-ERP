-- has_role() declared a local variable named `current_role`, which collides
-- with CURRENT_ROLE, Postgres's own reserved keyword for "the active
-- database role" (always 'authenticated' under PostgREST/RLS). The RETURN
-- comparisons were silently evaluating against 'authenticated' instead of
-- the profiles.role value fetched by the SELECT INTO just above them, so
-- has_role('admin') / has_role('lead') always returned false regardless of
-- the caller's actual role. 243 RLS policies depend on this function.
--
-- Fix: rename the variable so it no longer shadows the keyword. No policy
-- logic changes -- every policy already says what it meant to say.

create or replace function public.has_role(required_role text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  profile_role text;
  is_lead boolean := false;
begin
  select role::text, coalesce(is_department_lead, false)
    into profile_role, is_lead
  from public.profiles
  where id = auth.uid();

  case required_role
    when 'visitor' then
      return profile_role in ('visitor', 'employee', 'admin', 'super_admin', 'developer') or is_lead;
    when 'employee', 'staff' then
      return profile_role in ('employee', 'admin', 'super_admin', 'developer') or is_lead;
    when 'lead' then
      return is_lead or profile_role in ('admin', 'super_admin', 'developer');
    when 'admin' then
      return profile_role in ('admin', 'super_admin', 'developer');
    when 'super_admin' then
      return profile_role in ('super_admin', 'developer');
    when 'developer' then
      return profile_role = 'developer';
    else
      return false;
  end case;
end;
$function$;
