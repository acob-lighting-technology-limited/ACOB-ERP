-- pg_cron job that runs every 15 minutes and invokes the send-attendance-daily-report
-- edge function. That function reads the admin-configured send times / recipients from
-- system_settings (key "attendance_daily_report_config") and decides whether a slot is
-- due (and skips weekends) — the schedule itself is fully admin-editable at runtime via
-- the Attendance Reports dialog, not baked into this cron expression.
do $$
declare
  v_anon_key text;
begin
  select decrypted_secret into v_anon_key from vault.decrypted_secrets where name = 'anon_key';
  if v_anon_key is null or v_anon_key = '' then
    v_anon_key := nullif(current_setting('app.settings.anon_key', true), '');
  end if;

  perform cron.schedule(
    'process-attendance-daily-report',
    '*/15 * * * *',
    format(
      $f$
      select net.http_post(
        url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-attendance-daily-report',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || %L),
        body := '{}'::jsonb
      );
      $f$,
      coalesce(v_anon_key, '')
    )
  );
end;
$$;

