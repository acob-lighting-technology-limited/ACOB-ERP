-- Fix process_digest_schedules: add fallback for service_role_key and supabase_url
-- when app.settings.* are not configured (they weren't set, causing NULL auth headers
-- and 401 "Missing authorization header" from every edge function call).
CREATE OR REPLACE FUNCTION public.process_digest_schedules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
  service_key  := current_setting('app.settings.service_role_key', true);

  IF supabase_url IS NULL OR supabase_url = '' THEN
    supabase_url := 'https://itqegqxeqkeogwrvlzlj.supabase.co';
  END IF;

  IF service_key IS NULL OR service_key = '' THEN
    service_key := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTY0MjQ1NywiZXhwIjoyMDc3MjE4NDU3fQ.uUEg9q9jT9IsERFmmhmYMxdIr_xgakdf52EmMEZbf50';
  END IF;

  SELECT * INTO current_info FROM public.get_current_iso_week();

  today_dow := EXTRACT(ISODOW FROM CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::int;
  now_time   := (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::time;

  FOR schedule IN
    SELECT * FROM public.digest_schedules WHERE is_active = true
  LOOP
    -- One-time: fire when next_run_at is due
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

    -- Recurring: fire on the matching day+time, once per day
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
$$;
