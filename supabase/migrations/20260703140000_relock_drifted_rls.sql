-- Re-lock tables whose RLS protection was missing in production.
--   * cbt_questions / cbt_attempts: RLS + policies were created by 20260409183000
--     but were later manually DISABLED and the policies DROPPED directly on the
--     live database (schema drift). This restores the original intent.
--   * attendance_exempt_periods: created by 20260515153000 with NO RLS ever enabled.
--
-- IMPORTANT: cbt_attempts is read by app/api/admin/hr/performance/cbt/attempts/route.ts
-- using the RLS-RESPECTING server client (createClient), so it REQUIRES the
-- cbt_attempts_select_authenticated policy below — enabling RLS without it would
-- break the admin CBT-attempts dashboard.
--
-- cbt_questions is read/written only via the service-role client, but its policies
-- are restored anyway to match the original design and to cover the
-- getServiceRoleClientOrFallback() fallback path.

alter table public.cbt_questions enable row level security;
alter table public.cbt_attempts enable row level security;
alter table public.attendance_exempt_periods enable row level security;

-- The anon role must never read or write HR / exam data directly.
revoke all on public.cbt_questions from anon;
revoke all on public.cbt_attempts from anon;
revoke all on public.attendance_exempt_periods from anon;

-- ---- cbt_questions: admin-only (restores 20260409183000 intent) ----
drop policy if exists "cbt_questions_select_authenticated" on public.cbt_questions;
create policy "cbt_questions_select_authenticated"
on public.cbt_questions for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

drop policy if exists "cbt_questions_manage_authenticated" on public.cbt_questions;
create policy "cbt_questions_manage_authenticated"
on public.cbt_questions for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin')
  )
);

-- ---- cbt_attempts: own row or admin (restores 20260409183000 intent) ----
drop policy if exists "cbt_attempts_select_authenticated" on public.cbt_attempts;
create policy "cbt_attempts_select_authenticated"
on public.cbt_attempts for select to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

-- ---- attendance_exempt_periods: own row read; admin read/manage ----
-- All current app access is via the service-role client (which bypasses RLS);
-- these policies make it correct even under the OrFallback authenticated path.
drop policy if exists "attendance_exempt_periods_select" on public.attendance_exempt_periods;
create policy "attendance_exempt_periods_select"
on public.attendance_exempt_periods for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

drop policy if exists "attendance_exempt_periods_manage" on public.attendance_exempt_periods;
create policy "attendance_exempt_periods_manage"
on public.attendance_exempt_periods for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);
