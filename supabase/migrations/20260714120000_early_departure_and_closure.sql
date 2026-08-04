-- Early-departure support:
--   1. attendance_early_closures — org-wide "office closed early" days. On such a
--      day, early-departure is measured against close_time instead of the policy
--      end time, so anyone who left at/after close_time is not penalised.
--   2. Allow the manual per-record status 'early_departure_with_permission' (LEWP)
--      to survive the status-normalisation trigger, exactly like LWP/AWP/OOS.
--
-- 'early_departure' and 'early_closure' themselves are DERIVED at display time from
-- the punches + these closure rows, so they are not stored on attendance_records.

create table if not exists public.attendance_early_closures (
  closure_date date primary key,
  close_time time not null,
  name text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.attendance_early_closures is
  'Org-wide early office-closure days. On closure_date, early-departure is measured against close_time instead of the policy end time.';

alter table public.attendance_early_closures enable row level security;

-- Everyone signed in can read closures (needed to derive/display status); writes go
-- through the service-role admin API routes, so no mutation policy is granted here.
drop policy if exists "attendance_early_closures_select" on public.attendance_early_closures;
create policy "attendance_early_closures_select"
  on public.attendance_early_closures
  for select
  to authenticated
  using (true);

grant select on table public.attendance_early_closures to authenticated;
grant all on table public.attendance_early_closures to service_role;

-- Preserve the new manual permission status through the normalisation trigger.
create or replace function public.normalize_attendance_record_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'half_day' then
    return new;
  end if;

  if coalesce(new.waived, false) then
    new.status := 'waiver';
    return new;
  end if;

  -- Preserve manual statuses (added early_departure_with_permission).
  if new.status in (
    'lateness_with_permission',
    'absent_with_permission',
    'early_departure_with_permission',
    'out_of_station',
    'on_leave',
    'exempted',
    'waiver'
  ) then
    return new;
  end if;

  new.status := public.derive_attendance_status(new.clock_in, new.clock_out);
  return new;
end;
$$;
