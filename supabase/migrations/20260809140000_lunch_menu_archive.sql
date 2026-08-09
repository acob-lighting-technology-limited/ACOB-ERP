-- Archiving a lunch menu.
--
-- Cancelling a day's lunch has a payroll consequence: every vote on it wrote an
-- attendance_lunch_log row, and those feed the STAFF LUNCH deduction. Hard
-- deleting the menu clears the charges but also destroys the record of who
-- chose what — exactly what you need months later when somebody queries a
-- deduction.
--
-- Archiving keeps the votes and the menu, hides it from staff, and clears the
-- charges. Restoring puts the charges back from the votes that never went away.

alter table public.lunch_menus
  add column if not exists archived_at timestamptz;

alter table public.lunch_menus
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

comment on column public.lunch_menus.archived_at is
  'Set when a day is cancelled. Archived menus are hidden from staff and carry no lunch deduction, but keep their votes for the record.';

-- Staff-facing reads filter on this, so keep it cheap.
create index if not exists idx_lunch_menus_archived on public.lunch_menus (archived_at) where archived_at is null;

-- Staff must not see an archived day at all; admins still can.
drop policy if exists "lunch_menus_select" on public.lunch_menus;
create policy "lunch_menus_select"
  on public.lunch_menus
  for select
  to authenticated
  using (
    (status <> 'draft' and archived_at is null)
    or (select public.has_role('admin'))
  );
