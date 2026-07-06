-- pg_cron job that runs every 15 minutes and invokes the send-attendance-daily-report
-- edge function. That function reads the admin-configured send times / recipients from
-- system_settings (key "attendance_daily_report_config") and decides whether a slot is
-- due (and skips weekends) — the schedule itself is fully admin-editable at runtime via
-- the Attendance Reports dialog, not baked into this cron expression.
select cron.schedule(
  'process-attendance-daily-report',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-attendance-daily-report',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
