-- Payslips were being reconstructed at view time (basic/housing/pension re-derived
-- from basic_salary%, and the lateness surcharge back-computed as a leftover), so
-- historical payslips silently drift if the calculation formula ever changes.
-- Store the full computed breakdown as an immutable snapshot at publish time instead.
--
-- Also adds real columns for what was previously smuggled into leave_deduction
-- ("lunch") and other_deductions ("loan"), and backfills them so old rows still
-- read correctly under the new column names.

alter table public.payroll_entries
  add column if not exists breakdown jsonb not null default '{}'::jsonb,
  add column if not exists lunch_deduction numeric(10,2) not null default 0,
  add column if not exists loan_repayment numeric(10,2) not null default 0,
  add column if not exists lateness_surcharge numeric(10,2) not null default 0,
  add column if not exists absent_surcharge numeric(10,2) not null default 0,
  add column if not exists pension_employee numeric(10,2) not null default 0,
  add column if not exists pension_employer numeric(10,2) not null default 0;

update public.payroll_entries
set
  lunch_deduction = coalesce(leave_deduction, 0),
  loan_repayment = coalesce(other_deductions, 0)
where breakdown = '{}'::jsonb;

comment on column public.payroll_entries.breakdown is
  'Immutable PayrollBreakdown snapshot (lib/hr/payroll-utils.ts) captured at publish time. Payslip views render from this, not from recomputation.';
comment on column public.payroll_entries.lunch_deduction is 'Staff lunch deduction. Replaces the legacy leave_deduction column reuse.';
comment on column public.payroll_entries.loan_repayment is 'Loan repayment deduction. Replaces the legacy other_deductions column reuse.';
