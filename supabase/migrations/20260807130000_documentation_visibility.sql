-- Internal documentation: let an author publish a note to the whole company.
--
-- Until now every user_documentation row was private to its author (plus their
-- department lead, via the existing "Leads can view dept team documentation"
-- policy). There was no way to share a write-up organisation-wide, so useful
-- process notes stayed invisible.
--
-- visibility:
--   'private' — author + their department lead + admins (unchanged behaviour)
--   'general' — every authenticated staff member can read it
--
-- Defaults to 'private' so nothing already written becomes public on deploy.

alter table if exists public.user_documentation
  add column if not exists visibility text not null default 'private';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_documentation_visibility_check'
  ) then
    alter table public.user_documentation
      add constraint user_documentation_visibility_check
      check (visibility in ('private', 'general'));
  end if;
end $$;

comment on column public.user_documentation.visibility is
  'private = author, their lead and admins only. general = readable by any authenticated staff member.';

-- Partial index: the "General" tab lists only published notes.
create index if not exists idx_user_documentation_general
  on public.user_documentation (updated_at desc)
  where visibility = 'general';

-- Read access for published notes. Author-owned and lead-scoped reads keep
-- working through the existing policies; this only widens 'general' rows.
drop policy if exists "Anyone can view general documentation" on public.user_documentation;
create policy "Anyone can view general documentation"
  on public.user_documentation
  for select
  to authenticated
  using (visibility = 'general');
