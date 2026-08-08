-- Anonymous staff feedback on past lunch menus.
--
-- Staff rate a day's food after the fact; HR sees the ratings and comments in
-- aggregate so catering can be adjusted, but not who said what.
--
-- On anonymity: user_id IS stored. It is needed to keep one review per person
-- per day and to let an author revise their own. The anonymity guarantee is
-- that no admin-facing query or API response ever selects it — enforced in the
-- API layer (/api/admin/hr/lunch/reviews), because the service-role client used
-- by admin routes bypasses RLS. This is "not shown to staff or HR", not
-- cryptographic anonymity; anyone with direct database access could still join
-- the column.

create table if not exists public.lunch_reviews (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.lunch_menus(id) on delete cascade,
  -- Never exposed through any admin-facing endpoint. See note above.
  user_id uuid not null references public.profiles(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, user_id)
);

comment on table public.lunch_reviews is
  'Staff feedback on a past lunch menu. Shown to HR anonymously — user_id exists only to enforce one review per person and to let the author edit their own.';
comment on column public.lunch_reviews.user_id is
  'Author. MUST NOT be returned by any admin-facing query — reviews are surfaced anonymously.';

create index if not exists idx_lunch_reviews_menu on public.lunch_reviews (menu_id);

alter table public.lunch_reviews enable row level security;

-- Authors manage their own review, and only for a menu that has already
-- happened: there is nothing to review about food not yet served.
drop policy if exists "lunch_reviews_select_own" on public.lunch_reviews;
create policy "lunch_reviews_select_own"
  on public.lunch_reviews
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "lunch_reviews_insert_own" on public.lunch_reviews;
create policy "lunch_reviews_insert_own"
  on public.lunch_reviews
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.lunch_menus m
      where m.id = lunch_reviews.menu_id
        and m.date < current_date
    )
  );

drop policy if exists "lunch_reviews_update_own" on public.lunch_reviews;
create policy "lunch_reviews_update_own"
  on public.lunch_reviews
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "lunch_reviews_delete_own" on public.lunch_reviews;
create policy "lunch_reviews_delete_own"
  on public.lunch_reviews
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
