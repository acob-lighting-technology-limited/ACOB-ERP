-- action_items rows created from a single weekly report submission (or a single
-- carry-forward batch) previously shared one insert-time created_at value, so the
-- action tracker / action points report had no stable tiebreaker and could return
-- them in a different order than the original "Tasks for New Week" text.
alter table public.action_items
  add column if not exists position integer not null default 0;

-- Backfill existing rows so items from the same report keep a stable relative
-- order (falls back to id when created_at ties, matching insertion order).
with ranked as (
  select id, row_number() over (partition by report_id order by created_at, id) - 1 as rn
  from public.action_items
  where report_id is not null
)
update public.action_items ai
set position = ranked.rn
from ranked
where ai.id = ranked.id;
