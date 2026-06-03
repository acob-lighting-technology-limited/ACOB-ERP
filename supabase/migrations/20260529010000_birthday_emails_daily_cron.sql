-- Daily pg_cron job that fires the send-birthday-emails edge function at
-- 23:00 UTC (00:00 Africa/Lagos). The edge function finds active employees
-- whose birthday (MM-DD) is "today" in Lagos time, emails each one (CC their
-- additional email), and records the send in birthday_email_log so no one is
-- emailed twice in the same year.
select cron.schedule(
  'send-birthday-emails-daily',
  '0 23 * * *',
  $job$
  select net.http_post(
    url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-birthday-emails',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
