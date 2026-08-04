-- Fix stale meeting week/year in recurring meeting reminders.
--
-- Root cause: recurring schedules store meetingWeek/meetingYear inside
-- meeting_config when created and never refresh them. The processor
-- regenerated only meetingDate each week, so the payload carried a stale
-- meetingWeek/meetingYear. The send-meeting-reminder edge function prefers
-- meetingWeek/meetingYear over meetingDate, so it resolved an old office week
-- (e.g. week 23 -> 15 June) instead of the real upcoming meeting -- causing
-- reminders sent in July to announce a date weeks in the past.
--
-- Fix: the processor already computes the correct office week/year for the
-- freshly-derived target_date (used for the KSS roster lookup); write those
-- values back into the outgoing payload so the edge function resolves the
-- correct week. This overrides any stale values stored in meeting_config.

create or replace function public.process_reminder_schedules()
returns void
language plpgsql
security definer
as $function$
declare
  schedule record;
  payload jsonb;
  lagos_now timestamp;
  lagos_today date;
  meeting_seed date;
  target_dow int;
  today_dow int;
  days_until int;
  target_date date;
  meeting_time_val time;
  office_year int;
  office_week int;
  office_year_start date;
  kss_department text;
  kss_presenter_id uuid;
  kss_presenter_name text;
  kss_presenter_department text;
  base_url text := 'https://itqegqxeqkeogwrvlzlj.supabase.co';
  anon_key text;
begin
  -- Retrieve anon_key from vault
  select decrypted_secret into anon_key
  from vault.decrypted_secrets
  where name = 'anon_key';

  -- Fallback to configuration settings
  if anon_key is null or anon_key = '' then
    anon_key := nullif(current_setting('app.anon_key', true), '');
  end if;

  -- Bail out if no key could be resolved
  if anon_key is null or anon_key = '' then
    raise warning 'anon_key is not configured in vault or app.anon_key; skipping reminder processing';
    return;
  end if;

  for schedule in
    select *
    from public.reminder_schedules
    where is_active = true
      and next_run_at is not null
      and next_run_at <= now()
  loop
    payload := coalesce(schedule.meeting_config, '{}'::jsonb);

    payload := payload
      || jsonb_build_object(
        'type', coalesce(payload->>'type', schedule.reminder_type),
        'recipients', schedule.recipients
      );

    if schedule.schedule_type = 'recurring' and coalesce(payload->>'type', schedule.reminder_type) = 'meeting' then
      lagos_now := now() at time zone 'Africa/Lagos';
      lagos_today := lagos_now::date;

      begin
        meeting_seed := nullif(payload->>'meetingDate', '')::date;
      exception when others then
        meeting_seed := null;
      end;

      if meeting_seed is null then
        target_dow := 1; -- Monday
      else
        target_dow := extract(dow from meeting_seed)::int;
      end if;

      today_dow := extract(dow from lagos_today)::int;
      days_until := (target_dow - today_dow + 7) % 7;
      target_date := lagos_today + days_until;

      begin
        meeting_time_val := coalesce(nullif(payload->>'meetingTime', '')::time, time '08:30');
      exception when others then
        meeting_time_val := time '08:30';
      end;

      if days_until = 0 and (lagos_now::time >= meeting_time_val) then
        target_date := target_date + interval '7 days';
      end if;

      payload := payload || jsonb_build_object('meetingDate', to_char(target_date, 'YYYY-MM-DD'));

      -- Resolve office week/year from computed target date.
      office_year := extract(year from target_date)::int;
      office_year_start := public.office_week_year_start(office_year);
      if target_date < office_year_start then
        office_year := office_year - 1;
        office_year_start := public.office_week_year_start(office_year);
      end if;
      office_week := floor((target_date - office_year_start)::numeric / 7) + 1;

      -- Refresh the office week/year in the payload so the edge function does not
      -- resolve a stale week that was frozen into meeting_config at creation time.
      payload := payload || jsonb_build_object(
        'meetingWeek', office_week,
        'meetingYear', office_year
      );

      -- Fetch KSS presenter
      select r.department, r.presenter_id, r.presenter_name, p.full_name, p.department
      into kss_department, kss_presenter_id, kss_presenter_name, kss_presenter_department
      from public.kss_weekly_roster r
      left join public.profiles p on p.id = r.presenter_id
      where r.meeting_week = office_week
        and r.meeting_year = office_year
        and r.is_active = true
      order by r.updated_at desc
      limit 1;

      payload := payload - 'knowledgeSharingDepartment' - 'knowledgeSharingPresenter';

      if kss_department is not null then
        payload := payload || jsonb_build_object('knowledgeSharingDepartment', kss_department);

        if kss_presenter_id is not null and kss_presenter_name is not null then
          payload := payload || jsonb_build_object(
            'knowledgeSharingPresenter',
            jsonb_build_object(
              'id', kss_presenter_id,
              'full_name', kss_presenter_name,
              'department', coalesce(kss_presenter_department, kss_department)
            )
          );
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_with_presenter');
        elsif kss_presenter_name is not null and kss_presenter_name <> '' then
          payload := payload || jsonb_build_object(
            'knowledgeSharingPresenter',
            jsonb_build_object(
              'presenter_name', kss_presenter_name,
              'department', kss_department
            )
          );
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_with_visitor');
        else
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_department_only');
        end if;
      else
        payload := payload || jsonb_build_object('kssRosterStatus', 'missing');
      end if;
    end if;

    perform net.http_post(
      url := base_url || '/functions/v1/send-meeting-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      ),
      body := payload
    );

    if schedule.schedule_type = 'recurring' then
      update public.reminder_schedules
      set
        next_run_at = greatest(next_run_at, now()) + interval '7 days',
        updated_at = now()
      where id = schedule.id;
    else
      update public.reminder_schedules
      set
        is_active = false,
        updated_at = now()
      where id = schedule.id;
    end if;
  end loop;
end;
$function$;
