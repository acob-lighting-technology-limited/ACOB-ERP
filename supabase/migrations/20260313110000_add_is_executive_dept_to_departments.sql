-- Add a permanent flag to mark which department acts as the final approver
-- in the correspondence approval chain. This replaces the fragile name/code
-- lookups that broke whenever the department was renamed or its code changed.
-- Only one department should have this set to true at a time.

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS is_executive_dept BOOLEAN NOT NULL DEFAULT false;

-- Mark Executive Management as the executive department
UPDATE public.departments
SET is_executive_dept = true
WHERE department_code = 'MD';
