-- Ensure approved correspondence always receives a reference number,
-- regardless of which API path performs the status update.

create or replace function public.correspondence_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_reference_year integer;
begin
  if new.status = 'approved' and (new.reference_number is null or btrim(new.reference_number) = '') then
    if new.department_code is null or btrim(new.department_code) = '' then
      raise exception 'Department code is required before approval';
    end if;
    if new.recipient_code is null or btrim(new.recipient_code) = '' then
      raise exception 'Recipient code is required before approval';
    end if;

    v_reference_year := extract(year from coalesce(new.submitted_at, new.created_at, now()))::integer;
    new.reference_number := public.generate_correspondence_reference(
      upper(trim(new.department_code)),
      upper(trim(new.recipient_code)),
      null,
      coalesce(nullif(trim(new.company_code), ''), 'ACOB'),
      v_reference_year
    );
  end if;

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

-- Backfill any already-finalized records that are missing references.
update public.correspondence_records
set reference_number = public.generate_correspondence_reference(
  upper(trim(department_code)),
  upper(trim(recipient_code)),
  null,
  coalesce(nullif(trim(company_code), ''), 'ACOB'),
  extract(year from coalesce(submitted_at, created_at, now()))::integer
)
where status in ('approved', 'sent', 'filed', 'closed')
  and (reference_number is null or btrim(reference_number) = '')
  and department_code is not null
  and btrim(department_code) <> ''
  and recipient_code is not null
  and btrim(recipient_code) <> '';
