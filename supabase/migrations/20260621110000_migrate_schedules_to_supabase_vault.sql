-- Migrate schedules and notification functions to retrieve keys from Supabase Vault.
-- We check if the vault secrets exist, create them if they do not, and then redefine
-- the functions process_reminder_schedules, process_notification_queue, and process_digest_schedules.

-- 1. Initialize secrets in Supabase Vault if not already present
DO $$
BEGIN
  -- Insert anon_key
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'anon_key') THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog',
      'anon_key',
      'Supabase anon API key'
    );
  END IF;

  -- Insert service_role_key
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key') THEN
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY0MjQ1NywiZXhwIjoyMDc3MjE4NDU3fQ.uUEg9q9jT9IsERFmmhmYMxdIr_xgakdf52EmMEZbf50',
      'service_role_key',
      'Supabase service_role API key'
    );
  END IF;
END $$;

-- 2. Redefine process_reminder_schedules() using the Vault secret
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
  anon_key text;
BEGIN
  -- Retrieve anon_key from vault
  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'anon_key';

  -- Fallback to configuration settings
  IF anon_key IS NULL OR anon_key = '' THEN
    anon_key := NULLIF(current_setting('app.anon_key', true), '');
  END IF;

  -- Bails out if no key could be resolved
  IF anon_key IS NULL OR anon_key = '' THEN
    RAISE WARNING 'anon_key is not configured in vault or app.anon_key; skipping reminder processing';
    RETURN;
  END IF;

  FOR schedule IN
    SELECT *
    FROM public.reminder_schedules
    WHERE is_active = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= NOW()
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

      -- Resolve office week/year from computed target date.
      office_year := extract(year from target_date)::int;
      office_year_start := public.office_week_year_start(office_year);
      IF target_date < office_year_start THEN
        office_year := office_year - 1;
        office_year_start := public.office_week_year_start(office_year);
      END IF;
      office_week := floor((target_date - office_year_start)::numeric / 7) + 1;

      -- Fetch KSS presenter
      SELECT r.department, r.presenter_id, r.presenter_name, p.full_name, p.department
      INTO kss_department, kss_presenter_id, kss_presenter_name, kss_presenter_department
      FROM public.kss_weekly_roster r
      LEFT JOIN public.profiles p ON p.id = r.presenter_id
      WHERE r.meeting_week = office_week
        AND r.meeting_year = office_year
        AND r.is_active = true
      ORDER BY r.updated_at DESC
      LIMIT 1;

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

-- 3. Redefine process_notification_queue() using the Vault secret
CREATE OR REPLACE FUNCTION public.process_notification_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  r RECORD;
  v_notification_id UUID;
  v_service_key TEXT;
  v_webhook_secret TEXT := 'acob_notification_trigger_secret_2026';
  v_safe_type TEXT;
BEGIN
  -- Retrieve service_role_key from vault
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  -- Fallback to configuration settings or hardcoded (for safe transition)
  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := COALESCE(
      current_setting('app.service_role_key', true),
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY0MjQ1NywiZXhwIjoyMDc3MjE4NDU3fQ.uUEg9q9jT9IsERFmmhmYMxdIr_xgakdf52EmMEZbf50'
    );
  END IF;

  FOR r IN
    SELECT * FROM public.notification_queue
    WHERE status != 'sent' AND status != 'cancelled'
      AND (process_after IS NULL OR process_after <= now())
    LIMIT 20
  LOOP
    v_safe_type := CASE
      WHEN r.type = 'asset_assignment' THEN 'asset_assigned'
      WHEN r.type = 'asset_transfer_incoming' THEN 'asset_transfer_incoming'
      WHEN r.type = 'asset_returned' THEN 'asset_returned'
      ELSE r.type
    END;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, data, priority, created_at)
      VALUES (r.user_id, v_safe_type, r.title, r.message, r.data, 'normal', NOW())
      RETURNING id INTO v_notification_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to insert UI notification: %', SQLERRM;
    END;
    PERFORM net.http_post(
      url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-email-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key,
        'x-webhook-secret', v_webhook_secret
      ),
      body := jsonb_build_object(
        'record', jsonb_build_object(
          'id', r.id,
          'user_id', r.user_id,
          'type', r.type,
          'title', r.title,
          'message', r.message,
          'data', r.data
        )
      )
    );
    UPDATE public.notification_queue SET status = 'sent', sent_at = NOW() WHERE id = r.id;
  END LOOP;
END;
$function$;

-- 4. Redefine process_digest_schedules() using the Vault secret
CREATE OR REPLACE FUNCTION public.process_digest_schedules()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  schedule     RECORD;
  current_info RECORD;
  supabase_url text;
  service_key  text;
  payload      jsonb;
  day_num      int;
  today_dow    int;
  now_time     time;
BEGIN
  supabase_url := current_setting('app.settings.supabase_url', true);
  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://itqegqxeqkeogwrvlzlj.supabase.co';
  END IF;

  -- Retrieve service_role_key from vault
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  -- Fallback to configuration settings or hardcoded (for safe transition)
  IF service_key IS NULL OR service_key = '' THEN
    service_key := COALESCE(
      current_setting('app.settings.service_role_key', true),
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY0MjQ1NywiZXhwIjoyMDc3MjE4NDU3fQ.uUEg9q9jT9IsERFmmhmYMxdIr_xgakdf52EmMEZbf50'
    );
  END IF;

  SELECT * INTO current_info FROM public.get_current_iso_week();

  today_dow := EXTRACT(ISODOW FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::int;
  now_time   := (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::time;

  FOR schedule IN
    SELECT * FROM public.digest_schedules WHERE is_active = true
  LOOP
    IF schedule.schedule_type = 'one_time' THEN
      IF schedule.next_run_at IS NOT NULL AND schedule.next_run_at <= NOW() THEN
        payload := jsonb_build_object(
          'meetingWeek',   schedule.meeting_week,
          'meetingYear',   schedule.meeting_year,
          'recipients',    schedule.recipients,
          'contentChoice', schedule.content_choice
        );

        PERFORM net.http_post(
          url     := supabase_url || '/functions/v1/send-weekly-digest',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || service_key
          ),
          body    := payload
        );

        UPDATE public.digest_schedules
        SET is_active = false, last_sent_at = NOW()
        WHERE id = schedule.id;
      END IF;

    ELSIF schedule.schedule_type = 'recurring' THEN
      day_num := CASE schedule.send_day
        WHEN 'monday'    THEN 1
        WHEN 'tuesday'   THEN 2
        WHEN 'wednesday' THEN 3
        WHEN 'thursday'  THEN 4
        WHEN 'friday'    THEN 5
        WHEN 'saturday'  THEN 6
        WHEN 'sunday'    THEN 7
        ELSE 1
      END;

      IF today_dow = day_num
         AND now_time >= schedule.send_time
         AND (schedule.last_sent_at IS NULL
              OR schedule.last_sent_at < date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::timestamptz)
      THEN
        payload := jsonb_build_object(
          'meetingWeek',   current_info.week,
          'meetingYear',   current_info.year,
          'recipients',    schedule.recipients,
          'contentChoice', schedule.content_choice
        );

        PERFORM net.http_post(
          url     := supabase_url || '/functions/v1/send-weekly-digest',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', 'Bearer ' || service_key
          ),
          body    := payload
        );

        UPDATE public.digest_schedules
        SET last_sent_at = NOW()
        WHERE id = schedule.id;
      END IF;
    END IF;
  END LOOP;
END;
$function$;
