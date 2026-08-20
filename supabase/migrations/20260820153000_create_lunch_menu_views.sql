-- Create lunch_menu_views table to track staff member views of daily lunch menus
create table if not exists public.lunch_menu_views (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.lunch_menus(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, user_id)
);

comment on table public.lunch_menu_views is
  'Tracks which staff members have viewed a daily lunch menu, when they first/last opened it, and view counts.';

create index if not exists idx_lunch_menu_views_menu on public.lunch_menu_views (menu_id);
create index if not exists idx_lunch_menu_views_user on public.lunch_menu_views (user_id);
create index if not exists idx_lunch_menu_views_first_viewed on public.lunch_menu_views (first_viewed_at);

alter table public.lunch_menu_views enable row level security;

drop policy if exists "lunch_menu_views_select" on public.lunch_menu_views;
create policy "lunch_menu_views_select"
  on public.lunch_menu_views
  for select
  to authenticated
  using (
    user_id = auth.uid()
    or (select public.has_role('admin'))
  );

drop policy if exists "lunch_menu_views_insert" on public.lunch_menu_views;
create policy "lunch_menu_views_insert"
  on public.lunch_menu_views
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or (select public.has_role('admin'))
  );

drop policy if exists "lunch_menu_views_update" on public.lunch_menu_views;
create policy "lunch_menu_views_update"
  on public.lunch_menu_views
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or (select public.has_role('admin'))
  )
  with check (
    user_id = auth.uid()
    or (select public.has_role('admin'))
  );

drop policy if exists "lunch_menu_views_delete" on public.lunch_menu_views;
create policy "lunch_menu_views_delete"
  on public.lunch_menu_views
  for delete
  to authenticated
  using ((select public.has_role('admin')));

-- Atomic upsert for view tracking. Derives the user from auth.uid() rather than a
-- parameter so a caller cannot record a view on someone else's behalf, and folds
-- the insert/increment into one statement so concurrent opens cannot collide on
-- the (menu_id, user_id) unique constraint.
create or replace function public.record_lunch_menu_view(p_menu_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'record_lunch_menu_view requires an authenticated caller';
  end if;

  insert into public.lunch_menu_views (menu_id, user_id, first_viewed_at, last_viewed_at, view_count)
  values (p_menu_id, v_user_id, now(), now(), 1)
  on conflict (menu_id, user_id) do update
    set last_viewed_at = now(),
        view_count = public.lunch_menu_views.view_count + 1,
        updated_at = now();
end;
$$;

revoke execute on function public.record_lunch_menu_view(uuid) from anon, public;
grant execute on function public.record_lunch_menu_view(uuid) to authenticated, service_role;
