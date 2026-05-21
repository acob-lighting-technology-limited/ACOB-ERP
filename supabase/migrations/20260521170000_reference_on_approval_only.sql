-- Generate correspondence reference numbers only at final approval.
-- Also clears references from non-approved records and realigns counters.

alter table public.correspondence_records
  alter column reference_number drop not null;

create or replace function public.correspondence_before_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_department_code text;
  v_year integer;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  new.created_by_id := auth.uid();

  if new.originator_id is null then
    new.originator_id := auth.uid();
  end if;

  if new.reference_number is not null and btrim(new.reference_number) <> '' and auth.role() <> 'service_role' then
    raise exception 'Reference number is system-generated and cannot be set manually';
  end if;

  new.company_code := coalesce(nullif(trim(new.company_code), ''), 'ACOB');
  v_year := extract(year from coalesce(new.submitted_at, new.created_at, now()))::integer;

  if new.department_name is null or btrim(new.department_name) = '' then
    raise exception 'department_name is required';
  end if;

  if new.recipient_code is null or btrim(new.recipient_code) = '' then
    raise exception 'recipient_code is required';
  end if;
  new.recipient_code := upper(trim(new.recipient_code));

  if new.due_date is null then
    raise exception 'due_date is required';
  end if;

  if new.letter_type is null then
    new.letter_type := 'external';
  end if;

  select d.department_code into v_department_code
  from public.departments d
  where lower(trim(d.name)) = lower(trim(new.department_name))
    and d.is_active = true
    and d.department_code is not null
  limit 1;

  if v_department_code is null and new.department_code is not null and btrim(new.department_code) <> '' then
    v_department_code := upper(btrim(new.department_code));
  end if;

  if v_department_code is null then
    raise exception 'No department code configured for department "%". Please set a code in Admin → HR → Departments.', new.department_name;
  end if;

  new.department_code := v_department_code;
  if new.status is null then
    new.status := 'draft';
  end if;

  -- Reference is assigned only at final approval.
  new.reference_number := nullif(btrim(coalesce(new.reference_number, '')), '');

  return new;
end;
$$;

create or replace function public.correspondence_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.reference_number is distinct from new.reference_number then
    if not (
      old.reference_number is null
      and new.reference_number is not null
      and new.status = 'approved'
    ) then
      raise exception 'Reference number cannot be modified';
    end if;
  end if;

  if old.is_locked then
    if old.subject is distinct from new.subject
      or old.department_name is distinct from new.department_name
      or old.department_code is distinct from new.department_code
      or old.letter_type is distinct from new.letter_type
      or old.category is distinct from new.category
      or old.recipient_name is distinct from new.recipient_name
      or old.sender_name is distinct from new.sender_name
      or old.due_date is distinct from new.due_date
      or old.action_required is distinct from new.action_required
      or old.source_mode is distinct from new.source_mode
      or old.metadata is distinct from new.metadata
    then
      raise exception 'Locked correspondence cannot be edited';
    end if;
  end if;

  return new;
end;
$$;

-- Remove references from records not yet finalized to prevent skipped numbers.
alter table public.correspondence_records disable trigger trg_correspondence_records_before_update;

update public.correspondence_records
set reference_number = null
where status not in ('approved', 'sent', 'filed', 'closed')
  and reference_number is not null;

alter table public.correspondence_records enable trigger trg_correspondence_records_before_update;

-- Rebuild counters from only finalized records that still carry references.
delete from public.correspondence_counters;

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
  where status in ('approved', 'sent', 'filed', 'closed')
    and (
      reference_number ~ '^[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$'
      or reference_number ~ '^[^/]+/[^/]+/[^/]+/[^/]+/[0-9]{4}/[0-9]+$'
    )
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
from max_by_key;
