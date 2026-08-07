-- Lunch menu voting.
--
-- Admin publishes a menu for a given day. A menu is made of any number of
-- ordered, admin-named "groups" (categories): one category on a rice day
-- (White Rice / Jollof / Fried Rice), two when the meal pairs up (Egusi /
-- Ogbono / Afang, then Fufu / Eba / Semovita), three or more if needed. Each
-- category holds the options staff pick from.
--
-- A voter picks exactly one option per category — the unique (vote_id,
-- group_id) key on lunch_vote_selections below is what makes "two soups"
-- impossible at the storage layer, and the API rejects a vote that skips a
-- required category.
--
-- Results are deliberately visible to every authenticated member of staff
-- (WhatsApp-poll style, voter names included) — see the select policies below.

create table if not exists public.lunch_menus (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  title text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  -- Absolute cutoff for casting/changing a vote. Resolved at publish time from
  -- system_settings.lunch_settings.voting_deadline unless overridden per day.
  voting_deadline timestamptz,
  published_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.lunch_menus is
  'One lunch menu per date. Staff vote on its options until voting_deadline.';

create table if not exists public.lunch_menu_groups (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.lunch_menus(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  is_required boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.lunch_menu_groups is
  'An ordered, admin-named category within a menu. Voters pick exactly one option from each. A menu with a single category is a plain one-pick menu.';

create table if not exists public.lunch_menu_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.lunch_menu_groups(id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  is_available boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.lunch_votes (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.lunch_menus(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, user_id)
);

comment on table public.lunch_votes is
  'One vote per staff member per menu. Casting a vote also writes attendance_lunch_log for that day, which feeds the STAFF LUNCH payroll deduction.';

create table if not exists public.lunch_vote_selections (
  id uuid primary key default gen_random_uuid(),
  vote_id uuid not null references public.lunch_votes(id) on delete cascade,
  group_id uuid not null references public.lunch_menu_groups(id) on delete cascade,
  option_id uuid not null references public.lunch_menu_options(id) on delete cascade,
  unique (vote_id, group_id)
);

create index if not exists idx_lunch_menu_groups_menu on public.lunch_menu_groups (menu_id, position);
create index if not exists idx_lunch_menu_options_group on public.lunch_menu_options (group_id, position);
create index if not exists idx_lunch_votes_menu on public.lunch_votes (menu_id);
create index if not exists idx_lunch_votes_user on public.lunch_votes (user_id);
create index if not exists idx_lunch_vote_selections_vote on public.lunch_vote_selections (vote_id);
create index if not exists idx_lunch_vote_selections_option on public.lunch_vote_selections (option_id);

alter table public.lunch_menus enable row level security;
alter table public.lunch_menu_groups enable row level security;
alter table public.lunch_menu_options enable row level security;
alter table public.lunch_votes enable row level security;
alter table public.lunch_vote_selections enable row level security;

-- ── Menus ───────────────────────────────────────────────────────────────────
-- Staff see published/closed menus only; drafts stay admin-only so a
-- half-built menu never appears on /lunch.
drop policy if exists "lunch_menus_select" on public.lunch_menus;
create policy "lunch_menus_select"
  on public.lunch_menus
  for select
  to authenticated
  using (status <> 'draft' or (select public.has_role('admin')));

drop policy if exists "lunch_menus_admin_write" on public.lunch_menus;
create policy "lunch_menus_admin_write"
  on public.lunch_menus
  for all
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- ── Groups ──────────────────────────────────────────────────────────────────
drop policy if exists "lunch_menu_groups_select" on public.lunch_menu_groups;
create policy "lunch_menu_groups_select"
  on public.lunch_menu_groups
  for select
  to authenticated
  using (
    exists (
      select 1 from public.lunch_menus m
      where m.id = menu_id and (m.status <> 'draft' or (select public.has_role('admin')))
    )
  );

drop policy if exists "lunch_menu_groups_admin_write" on public.lunch_menu_groups;
create policy "lunch_menu_groups_admin_write"
  on public.lunch_menu_groups
  for all
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- ── Options ─────────────────────────────────────────────────────────────────
drop policy if exists "lunch_menu_options_select" on public.lunch_menu_options;
create policy "lunch_menu_options_select"
  on public.lunch_menu_options
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.lunch_menu_groups g
      join public.lunch_menus m on m.id = g.menu_id
      where g.id = group_id and (m.status <> 'draft' or (select public.has_role('admin')))
    )
  );

drop policy if exists "lunch_menu_options_admin_write" on public.lunch_menu_options;
create policy "lunch_menu_options_admin_write"
  on public.lunch_menu_options
  for all
  to authenticated
  using ((select public.has_role('admin')))
  with check ((select public.has_role('admin')));

-- ── Votes ───────────────────────────────────────────────────────────────────
-- Every member of staff can read every vote on a visible menu, by design:
-- the /lunch page shows who picked what, like a WhatsApp poll.
drop policy if exists "lunch_votes_select" on public.lunch_votes;
create policy "lunch_votes_select"
  on public.lunch_votes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.lunch_menus m
      where m.id = menu_id and (m.status <> 'draft' or (select public.has_role('admin')))
    )
  );

drop policy if exists "lunch_votes_insert_own" on public.lunch_votes;
create policy "lunch_votes_insert_own"
  on public.lunch_votes
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "lunch_votes_update_own" on public.lunch_votes;
create policy "lunch_votes_update_own"
  on public.lunch_votes
  for update
  to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')))
  with check (user_id = (select auth.uid()) or (select public.has_role('admin')));

drop policy if exists "lunch_votes_delete_own" on public.lunch_votes;
create policy "lunch_votes_delete_own"
  on public.lunch_votes
  for delete
  to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('admin')));

-- ── Vote selections ─────────────────────────────────────────────────────────
drop policy if exists "lunch_vote_selections_select" on public.lunch_vote_selections;
create policy "lunch_vote_selections_select"
  on public.lunch_vote_selections
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.lunch_votes v
      join public.lunch_menus m on m.id = v.menu_id
      where v.id = vote_id and (m.status <> 'draft' or (select public.has_role('admin')))
    )
  );

drop policy if exists "lunch_vote_selections_write_own" on public.lunch_vote_selections;
create policy "lunch_vote_selections_write_own"
  on public.lunch_vote_selections
  for all
  to authenticated
  using (
    exists (
      select 1 from public.lunch_votes v
      where v.id = vote_id and (v.user_id = (select auth.uid()) or (select public.has_role('admin')))
    )
  )
  with check (
    exists (
      select 1 from public.lunch_votes v
      where v.id = vote_id and (v.user_id = (select auth.uid()) or (select public.has_role('admin')))
    )
  );

grant select on table public.lunch_menus to authenticated;
grant select on table public.lunch_menu_groups to authenticated;
grant select on table public.lunch_menu_options to authenticated;
grant select, insert, update, delete on table public.lunch_votes to authenticated;
grant select, insert, update, delete on table public.lunch_vote_selections to authenticated;

grant all on table public.lunch_menus to service_role;
grant all on table public.lunch_menu_groups to service_role;
grant all on table public.lunch_menu_options to service_role;
grant all on table public.lunch_votes to service_role;
grant all on table public.lunch_vote_selections to service_role;
