-- Brings lunch voting up to its current shape on databases that already ran
-- 20260806130000 before it gained these columns. Every statement is a no-op on
-- a database created from the current version of that migration.
--
-- Why this exists: the earlier migration was edited after it had already been
-- applied, so `lunch_votes.is_eating` was missing in the live database while
-- the app selected it. That made every vote read fail and the poll show zero
-- votes even though the rows were there.

-- The poll's "NO" answer: a visible, deliberate "not eating today" that carries
-- no selections and no payroll deduction.
alter table public.lunch_votes
  add column if not exists is_eating boolean not null default true;

-- A single-category menu carries no heading, so the name became optional.
alter table public.lunch_menu_groups
  alter column name drop not null;

-- The staff-facing heading is derived from the date, never stored.
alter table public.lunch_menus
  drop column if exists title;

comment on column public.lunch_votes.is_eating is
  'False is the poll''s NO answer — visible to colleagues, but no selections and no lunch register entry.';
