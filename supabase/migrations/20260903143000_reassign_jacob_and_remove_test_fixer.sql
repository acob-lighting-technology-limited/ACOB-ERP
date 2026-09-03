-- Migration: Reassign Jacob Idinoba to ACOB/2026/067 and retire test account Matrix Fixer
-- Description: Frees up ACOB/2026/067 by removing employee_number from Matrix Fixer, sets Matrix Fixer to exited developer, assigns 067 to Jacob Idinoba, and sets sequence to 67 (nextval will be 68).

BEGIN;

-- 1. Enable employee number change bypass for this transaction
SET LOCAL app.allow_employee_number_change = 'on';

-- 2. Remove employee number from Matrix Fixer and mark status as exited / developer
UPDATE public.profiles
SET employee_number = NULL,
    employment_status = 'exited',
    role = 'developer'
WHERE id = 'd4a0a314-fdb3-4da2-8d42-cfc25134b795'
   OR company_email = 'e.matrix@org.acoblighting.com';

-- 3. Update Jacob Idinoba to ACOB/2026/067
UPDATE public.profiles
SET employee_number = 'ACOB/2026/067'
WHERE id = 'd3db447f-fe19-4226-913d-7fce5bd3ec7d'
  AND (company_email = 'i.jacob@org.acoblighting.com' OR first_name ILIKE 'Jacob');

-- 4. Set employee_number_seq to 67 so the next generated number is 68
SELECT setval('public.employee_number_seq', 67, true);

COMMIT;
