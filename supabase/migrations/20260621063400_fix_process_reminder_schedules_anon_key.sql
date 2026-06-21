-- Fix process_reminder_schedules(): the function was reading app.anon_key via
-- current_setting(), but that database config was never set, so every run
-- printed a NOTICE and skipped all due schedules — causing meeting reminder
-- emails to never fire.
--
-- The anon key is the same public JWT used by every other pg_cron job in this
-- project (check-payments-daily, send-birthday-emails). Embedding it here
-- follows the same established pattern.

CREATE OR REPLACE FUNCTION public.process_reminder_schedules()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  schedule RECORD;
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
  -- Anon key — same value used by check-payments-daily and send-birthday-emails
  -- pg_cron jobs. Kept here directly to avoid the unreliable current_setting()
  -- lookup that was the original cause of schedules being silently skipped.
  anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog';
BEGIN
  FOR schedule IN
    SELECT *
    FROM public.reminder_schedules
    WHERE is_active = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= NOW()
  -- Loop start
  LOOP
    payload := COALESCE(schedule.meeting_config, '{}'::jsonb);

    payload := payload
      || jsonb_build_object(
        'type', COALESCE(payload->>'type', schedule.reminder_type),
        'recipients', schedule.recipients
      );

    IF schedule.schedule_type = 'recurring' AND COALESCE(payload->>'type', schedule.reminder_type) = 'meeting' THEN
      lagos_now := NOW() AT TIME ZONE 'Africa/Lagos';
      lagos_today := lagos_now::date;

      BEGIN
        meeting_seed := NULLIF(payload->>'meetingDate', '')::date;
      EXCEPTION WHEN OTHERS THEN
        meeting_seed := NULL;
      END;

      IF meeting_seed IS NULL THEN
        target_dow := 1; -- Monday
      ELSE
        target_dow := extract(dow from meeting_seed)::int;
      END IF;

      today_dow := extract(dow from lagos_today)::int;
      days_until := (target_dow - today_dow + 7) % 7;
      target_date := lagos_today + days_until;

      BEGIN
        meeting_time_val := COALESCE(NULLIF(payload->>'meetingTime', '')::time, time '08:30');
      EXCEPTION WHEN OTHERS THEN
        meeting_time_val := time '08:30';
      END;

      IF days_until = 0 AND (lagos_now::time >= meeting_time_val) THEN
        target_date := target_date + INTERVAL '7 days';
      END IF;

      payload := payload || jsonb_build_object('meetingDate', to_char(target_date, 'YYYY-MM-DD'));

      -- Resolve office week/year from the computed target date.
      office_year := extract(year from target_date)::int;
      office_year_start := public.office_week_year_start(office_year);
      IF target_date < office_year_start THEN
        office_year := office_year - 1;
        office_year_start := public.office_week_year_start(office_year);
      END IF;
      office_week := floor((target_date - office_year_start)::numeric / 7) + 1;

      -- Fetch KSS presenter for the resolved office week.
      SELECT r.department, r.presenter_id, r.presenter_name, p.full_name, p.department
      INTO kss_department, kss_presenter_id, kss_presenter_name, kss_presenter_department
      FROM public.kss_weekly_roster r
      LEFT JOIN public.profiles p ON p.id = r.presenter_id
      WHERE r.meeting_week = office_week
        AND r.meeting_year = office_year
        AND r.is_active = true
      ORDER BY r.updated_at DESC
      LIMIT 1;

      -- Remove stale values from the initial schedule payload, then inject live values.
      payload := payload - 'knowledgeSharingDepartment' - 'knowledgeSharingPresenter';

      IF kss_department IS NOT NULL THEN
        payload := payload || jsonb_build_object('knowledgeSharingDepartment', kss_department);

        IF kss_presenter_id IS NOT NULL AND kss_presenter_name IS NOT NULL THEN
          payload := payload || jsonb_build_object(
            'knowledgeSharingPresenter',
            jsonb_build_object(
              'id', kss_presenter_id,
              'full_name', kss_presenter_name,
              'department', COALESCE(kss_presenter_department, kss_department)
            )
          );
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_with_presenter');
        ELSIF kss_presenter_name IS NOT NULL AND kss_presenter_name <> '' THEN
          payload := payload || jsonb_build_object(
            'knowledgeSharingPresenter',
            jsonb_build_object(
              'presenter_name', kss_presenter_name,
              'department', kss_department
            )
          );
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_with_visitor');
        ELSE
          payload := payload || jsonb_build_object('kssRosterStatus', 'enriched_department_only');
        END IF;
      ELSE
        payload := payload || jsonb_build_object('kssRosterStatus', 'missing');
      END IF;
    END IF;

    PERFORM net.http_post(
      url := base_url || '/functions/v1/send-meeting-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || anon_key,
        'apikey', anon_key
      ),
      body := payload
    );

    IF schedule.schedule_type = 'recurring' THEN
      UPDATE public.reminder_schedules
      SET
        next_run_at = GREATEST(next_run_at, NOW()) + INTERVAL '7 days',
        updated_at = NOW()
      WHERE id = schedule.id;
    ELSE
      UPDATE public.reminder_schedules
      SET
        is_active = false,
        updated_at = NOW()
      WHERE id = schedule.id;
    END IF;
  END LOOP;
END;
$function$;
