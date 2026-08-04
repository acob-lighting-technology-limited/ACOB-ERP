-- OOS periods + exemption schema tidy-up.
--
-- 1. Widen attendance_exempt_periods.kind so custom ranges and frozen infinite
--    exemptions are stored honestly instead of masquerading as 'monthly'
--    (removes the schema drift that shoehorned every custom window into 'monthly').
--
-- 2. Add attendance_oos_periods: the source of truth for recurring / indefinite
--    "Out of Station" directives. OOS itself stays MATERIALIZED into
--    attendance_records (so every existing reader keeps seeing it) — this table
--    only records the directive so an open-ended (indefinite) OOS can be extended
--    forward each day by the attendance cron and "stopped" by closing end_date at
--    today. A NULL end_date means indefinite/open.

-- ── 1. exempt kind CHECK ─────────────────────────────────────────────
alter table public.attendance_exempt_periods
  drop constraint if exists attendance_exempt_periods_kind_check;

alter table public.attendance_exempt_periods
  add constraint attendance_exempt_periods_kind_check
  check (kind in ('weekly', 'monthly', 'period', 'infinite'));

-- ── 2. attendance_oos_periods ────────────────────────────────────────
create table if not exists public.attendance_oos_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date null,                       -- NULL = indefinite / open-ended
  kind text not null default 'period'
    check (kind in ('weekly', 'monthly', 'period', 'infinite')),
  reason text null,
  status text not null default 'active'
    check (status in ('active', 'stopped')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_oos_periods_user_date
  on public.attendance_oos_periods (user_id, start_date, end_date);

-- Open (indefinite, still-active) directives the cron must extend forward.
create index if not exists idx_attendance_oos_periods_open
  on public.attendance_oos_periods (status)
  where end_date is null and status = 'active';

-- ── RLS (mirrors attendance_exempt_periods: own-row read, admin manage) ──
alter table public.attendance_oos_periods enable row level security;
revoke all on public.attendance_oos_periods from anon;

drop policy if exists "attendance_oos_periods_select" on public.attendance_oos_periods;
create policy "attendance_oos_periods_select"
on public.attendance_oos_periods for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

drop policy if exists "attendance_oos_periods_manage" on public.attendance_oos_periods;
create policy "attendance_oos_periods_manage"
on public.attendance_oos_periods for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);
