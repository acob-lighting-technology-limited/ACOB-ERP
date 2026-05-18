-- Add department_code to departments table as the single source of truth
-- for correspondence reference generation, replacing the separate
-- correspondence_department_codes table.

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS department_code TEXT
    CHECK (char_length(trim(department_code)) BETWEEN 2 AND 10);

-- Unique index (partial — only enforces uniqueness among non-null codes)
CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_department_code
  ON public.departments (department_code)
  WHERE department_code IS NOT NULL;

-- Migrate existing codes from correspondence_department_codes where names match
UPDATE public.departments d
SET department_code = upper(trim(cdc.department_code))
FROM public.correspondence_department_codes cdc
WHERE lower(trim(d.name)) = lower(trim(cdc.department_name))
  AND cdc.is_active = true
  AND d.department_code IS NULL;
