-- Phase 1c — Remove hardcoded production secrets from DB functions.
--
-- process_notification_queue() and process_digest_schedules() each embedded the
-- production service_role JWT (full RLS bypass) as a fallback literal, and
-- process_notification_queue() also embedded a static x-webhook-secret. Both are
-- in git history. This migration recreates both functions to source the service
-- key ONLY from Vault (vault.decrypted_secrets 'service_role_key'), fail safe if
-- absent, and drops the redundant x-webhook-secret header — the edge function is
-- authenticated by the service-role bearer these functions already send.
--
-- PREREQUISITE (manual, before applying): rotate the service_role key in the
-- Supabase dashboard and store the NEW value in Vault as 'service_role_key'.
-- Applying this before rotation is safe (no new secret introduced) but the old
-- leaked key remains valid until you roll it.

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_notification_queue()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  r RECORD;
  v_notification_id UUID;
  v_service_key TEXT;
  v_safe_type TEXT;
BEGIN
  -- Service key from Vault only — never hardcoded.
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  IF v_service_key IS NULL OR v_service_key = '' THEN
    v_service_key := NULLIF(current_setting('app.service_role_key', true), '');
  END IF;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    RAISE NOTICE 'service_role_key not configured; skipping notification queue processing';
    RETURN;
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
        'apikey', v_service_key
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

-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_digest_schedules()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
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

  -- Service key from Vault only — never hardcoded.
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key';

  IF service_key IS NULL OR service_key = '' THEN
    service_key := NULLIF(current_setting('app.settings.service_role_key', true), '');
  END IF;

  IF service_key IS NULL OR service_key = '' THEN
    RAISE NOTICE 'service_role_key not configured; skipping digest schedule processing';
    RETURN;
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
