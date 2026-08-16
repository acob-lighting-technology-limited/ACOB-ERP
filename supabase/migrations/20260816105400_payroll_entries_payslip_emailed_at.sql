-- Idempotency marker for the payslip mailer. A bulk send skips any row where
-- this is already set, so re-running a batch (a double-click, a crash mid-run,
-- a retry) can never mail the same employee twice.

alter table public.payroll_entries
  add column if not exists payslip_emailed_at timestamptz;

comment on column public.payroll_entries.payslip_emailed_at is
  'Set when the payslip PDF was successfully emailed to the employee. NULL means not yet sent. Bulk-send reads this to resume without re-mailing.';
