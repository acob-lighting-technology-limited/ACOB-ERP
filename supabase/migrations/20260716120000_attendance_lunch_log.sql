-- Daily staff lunch register, feeding the STAFF LUNCH deduction into payroll.
-- Referenced by app/api/admin/hr/lunch and the payroll run, but was never
-- migrated (only ever hand-created in prod). Adding it here, idempotently.

create table if not exists public.attendance_lunch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  cost numeric(10,2) not null default 0,
  company_subsidy numeric(10,2) not null default 0,
  employee_deduction numeric(10,2) not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

comment on table public.attendance_lunch_log is
  'Per-day record of which staff ate the subsidized lunch; employee_deduction sums into the STAFF LUNCH payroll deduction for the period.';

alter table public.attendance_lunch_log enable row level security;

drop policy if exists "attendance_lunch_log_select_own_or_admin" on public.attendance_lunch_log;
create policy "attendance_lunch_log_select_own_or_admin"
  on public.attendance_lunch_log
  for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

drop policy if exists "attendance_lunch_log_admin_write" on public.attendance_lunch_log;
create policy "attendance_lunch_log_admin_write"
  on public.attendance_lunch_log
  for all
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

grant select on table public.attendance_lunch_log to authenticated;
grant all on table public.attendance_lunch_log to service_role;

create index if not exists idx_attendance_lunch_log_date on public.attendance_lunch_log (date);
