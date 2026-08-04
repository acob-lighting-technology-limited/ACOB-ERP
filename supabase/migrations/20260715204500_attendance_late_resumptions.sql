-- Delayed resumption support (e.g. for rainy days)
-- Mirrors early-closures support structure

create table if not exists public.attendance_late_resumptions (
  resumption_date date primary key,
  resumption_time time not null,
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.attendance_late_resumptions is
  'Org-wide delayed office resumption days. On resumption_date, the office start time is officially delayed to resumption_time.';

alter table public.attendance_late_resumptions enable row level security;

drop policy if exists "attendance_late_resumptions_select" on public.attendance_late_resumptions;
create policy "attendance_late_resumptions_select"
  on public.attendance_late_resumptions
  for select
  to authenticated
  using (true);

grant select on table public.attendance_late_resumptions to authenticated;
grant all on table public.attendance_late_resumptions to service_role;
