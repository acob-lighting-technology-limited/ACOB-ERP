-- One LIVE menu per day, not one row per day.
--
-- Cancelling a day is almost always the prelude to putting a different meal up
-- for it — the kitchen changed what they are cooking. The old UNIQUE (date)
-- meant the cancelled menu kept squatting on the date and the replacement was
-- rejected with "a menu already exists for that date", which made archiving
-- useless in the one situation it exists for.
--
-- A partial unique index keeps the real rule (staff can never be shown two
-- menus for the same day) while letting any number of cancelled ones sit behind
-- it as history.

alter table public.lunch_menus
  drop constraint if exists lunch_menus_date_key;

create unique index if not exists idx_lunch_menus_one_live_per_date
  on public.lunch_menus (date)
  where archived_at is null;

comment on index public.idx_lunch_menus_one_live_per_date is
  'At most one non-archived menu per date. Cancelled menus stay as history and do not block a replacement.';
