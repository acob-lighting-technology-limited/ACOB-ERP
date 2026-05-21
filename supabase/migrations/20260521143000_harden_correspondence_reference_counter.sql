-- Ensure correspondence reference generation always accounts for existing
-- records (including manually inserted/imported references) to prevent
-- duplicate reference_number collisions.

-- 1) Backfill/re-align counters from existing references.
with derived as (
  select
    split_part(reference_number, '/', 2) as dept_code,
    split_part(reference_number, '/', 3) as recipient_code,
    case
      when reference_number ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$' then split_part(reference_number, '/', 4)
      else ''
    end as category_code,
    case
      when reference_number ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$' then split_part(reference_number, '/', 5)::int
      else split_part(reference_number, '/', 4)::int
    end as ref_year,
    case
      when reference_number ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$' then split_part(reference_number, '/', 6)::int
      else split_part(reference_number, '/', 5)::int
    end as ref_no
  from public.correspondence_records
  where
    reference_number ~ '^[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$'
    or reference_number ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$'
),
max_by_key as (
  select
    format('outgoing:%s:%s:%s', dept_code, recipient_code, category_code) as counter_key,
    ref_year as year,
    max(ref_no) as last_number
  from derived
  group by dept_code, recipient_code, category_code, ref_year
)
insert into public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
select counter_key, year, last_number, now(), now()
from max_by_key
on conflict (counter_key, year) do update
set
  last_number = greatest(public.correspondence_counters.last_number, excluded.last_number),
  updated_at = now();

-- 2) Harden generator: always use max(counter, existing refs) before increment.
create or replace function public.generate_correspondence_reference(
  p_department_code text,
  p_recipient_code  text,
  p_category_code   text    default null,
  p_company_code    text    default 'ACOB',
  p_reference_year  integer default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year           integer := coalesce(p_reference_year, extract(year from now())::integer);
  v_dept           text    := upper(trim(p_department_code));
  v_recipient      text    := upper(trim(p_recipient_code));
  v_cat            text    := nullif(trim(coalesce(p_category_code, '')), '');
  v_company        text    := coalesce(nullif(trim(p_company_code), ''), 'ACOB');
  v_key            text;
  v_prefix         text;
  v_counter_last   integer := 0;
  v_existing_last  integer := 0;
  v_next           integer;
begin
  if v_dept is null or v_dept = '' then
    raise exception 'Department code is required for correspondence references';
  end if;
  if v_recipient is null or v_recipient = '' then
    raise exception 'Recipient code is required for correspondence references';
  end if;

  v_key := format('outgoing:%s:%s:%s', v_dept, v_recipient, coalesce(v_cat, ''));

  if v_cat is not null then
    v_prefix := format('%s/%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_cat, v_year::text);
  else
    v_prefix := format('%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_year::text);
  end if;

  insert into public.correspondence_counters (counter_key, year, last_number)
  values (v_key, v_year, 0)
  on conflict (counter_key, year) do nothing;

  select coalesce(last_number, 0)
  into v_counter_last
  from public.correspondence_counters
  where counter_key = v_key and year = v_year
  for update;

  select coalesce(max((substring(reference_number from char_length(v_prefix) + 1))::int), 0)
  into v_existing_last
  from public.correspondence_records
  where reference_number like (v_prefix || '%')
    and substring(reference_number from char_length(v_prefix) + 1) ~ '^[0-9]+$';

  v_next := greatest(v_counter_last, v_existing_last) + 1;

  update public.correspondence_counters
  set last_number = v_next, updated_at = now()
  where counter_key = v_key and year = v_year;

  return v_prefix || lpad(v_next::text, 3, '0');
end;
$$;
