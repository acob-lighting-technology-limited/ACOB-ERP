-- Seed salary components for standard earnings and deductions
INSERT INTO public.salary_components (name, code, type, is_taxable, is_active)
VALUES
  ('Basic Salary', 'BASIC', 'earning', true, true),
  ('Housing Allowance', 'HOUSING', 'earning', true, true),
  ('Transport Allowance', 'TRANSPORT', 'earning', true, true),
  ('Communication Allowance', 'COMMUNICATION', 'earning', true, true),
  ('Leave Allowance', 'LEAVE_ALLOWANCE', 'earning', true, true),
  ('Medical HMO Benefit', 'HMO_BENEFIT', 'earning', false, true),
  ('Employee Pension Contribution', 'PENSION_EE', 'deduction', false, true),
  ('Employer Pension Contribution', 'PENSION_ER', 'earning', false, true),
  ('PAYE Tax Deduction', 'PAYE_TAX', 'deduction', false, true),
  ('Lateness Surcharge', 'LATENESS_SURCHARGE', 'deduction', false, true),
  ('Staff Lunch Deduction', 'LUNCH_DEDUCTION', 'deduction', false, true),
  ('Loan Repayment', 'LOAN_REPAYMENT', 'deduction', false, true)
ON CONFLICT (code) DO NOTHING;

-- Seed initial test base salary for Chibuikem Michael Ilonze (ID: 1aeae0c5-ef2f-4790-be14-d0e696be01af)
-- Base salary = 195,000 NGN
INSERT INTO public.employee_salaries (user_id, basic_salary, effective_from, is_active)
VALUES ('1aeae0c5-ef2f-4790-be14-d0e696be01af', 195000.00, '2026-01-01', true)
ON CONFLICT DO NOTHING;
