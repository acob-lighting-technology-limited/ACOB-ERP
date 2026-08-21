-- Migration: Standardize department names and remove ampersands across all tables
-- Canonical departments:
--   Accounts
--   Admin and HR
--   Business, Growth and Innovation
--   Corporate Services
--   Executive Management
--   IT and Communications
--   Operations and Maintenance
--   Project
--   Regulatory and Compliance
--   Technical

BEGIN;

-- 0. Temporarily drop check constraints that enforce legacy department or office_location names
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_department_check;
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_office_location_check;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_office_location_check;

-- 1. Standardize departments table
-- Handle merge/conflict if both 'Admin & HR' and 'Admin and HR' exist, or 'Operations' and 'Operations and Maintenance'
DO $$
BEGIN
  -- Standardize 'Admin & HR' -> 'Admin and HR'
  IF EXISTS (SELECT 1 FROM public.departments WHERE name = 'Admin and HR') THEN
    IF EXISTS (SELECT 1 FROM public.departments WHERE name = 'Admin & HR') THEN
      UPDATE public.profiles SET department_id = (SELECT id FROM public.departments WHERE name = 'Admin and HR') WHERE department_id = (SELECT id FROM public.departments WHERE name = 'Admin & HR');
      DELETE FROM public.departments WHERE name = 'Admin & HR';
    END IF;
  ELSE
    UPDATE public.departments SET name = 'Admin and HR' WHERE name = 'Admin & HR';
  END IF;

  -- Standardize 'Operations' / 'Operations & Maintenance' -> 'Operations and Maintenance'
  IF EXISTS (SELECT 1 FROM public.departments WHERE name = 'Operations and Maintenance') THEN
    IF EXISTS (SELECT 1 FROM public.departments WHERE name IN ('Operations', 'Operations & Maintenance')) THEN
      UPDATE public.profiles SET department_id = (SELECT id FROM public.departments WHERE name = 'Operations and Maintenance') WHERE department_id IN (SELECT id FROM public.departments WHERE name IN ('Operations', 'Operations & Maintenance'));
      DELETE FROM public.departments WHERE name IN ('Operations', 'Operations & Maintenance');
    END IF;
  ELSE
    UPDATE public.departments SET name = 'Operations and Maintenance' WHERE name IN ('Operations', 'Operations & Maintenance');
  END IF;

  -- Ensure all 10 canonical departments exist
  INSERT INTO public.departments (name, description) VALUES
    ('Accounts', 'Finance, accounting, budgeting, expenditure control, and financial reporting.'),
    ('Admin and HR', 'Human resources, staff welfare, office administration, and recruitment management.'),
    ('Business, Growth and Innovation', 'Business development, strategic partnerships, sales expansion, and innovation initiatives.'),
    ('Corporate Services', 'Corporate communications, facilities, legal support, and operational logistics.'),
    ('Executive Management', 'Executive leadership, strategic direction, governance, and organizational oversight.'),
    ('IT and Communications', 'Information technology infrastructure, software systems, network security, and internal communications.'),
    ('Operations and Maintenance', 'Field operations, system maintenance, infrastructure reliability, and quality assurance.'),
    ('Project', 'Project planning, execution, vendor coordination, and milestone delivery.'),
    ('Regulatory and Compliance', 'Legal compliance, policy adherence, statutory regulations, and industry standards.'),
    ('Technical', 'Technical engineering, research and development, design specifications, and hardware solutions.')
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description;
END $$;

-- 2. Standardize office_locations table
DO $$
BEGIN
  -- Handle 'Admin & HR' -> 'Admin and HR'
  IF EXISTS (SELECT 1 FROM public.office_locations WHERE name = 'Admin and HR') THEN
    DELETE FROM public.office_locations WHERE name = 'Admin & HR';
    UPDATE public.office_locations SET department = 'Admin and HR' WHERE name = 'Admin and HR';
  ELSE
    UPDATE public.office_locations SET name = 'Admin and HR', department = 'Admin and HR' WHERE name = 'Admin & HR';
  END IF;

  -- Handle 'Operations & Maintenance' / 'Operations' -> 'Operations and Maintenance'
  IF EXISTS (SELECT 1 FROM public.office_locations WHERE name = 'Operations and Maintenance') THEN
    DELETE FROM public.office_locations WHERE name IN ('Operations', 'Operations & Maintenance');
    UPDATE public.office_locations SET department = 'Operations and Maintenance' WHERE name = 'Operations and Maintenance';
  ELSE
    UPDATE public.office_locations SET name = 'Operations and Maintenance', department = 'Operations and Maintenance' WHERE name IN ('Operations', 'Operations & Maintenance');
  END IF;

  -- Handle 'IT & Communications' -> 'IT and Communications'
  IF EXISTS (SELECT 1 FROM public.office_locations WHERE name = 'IT and Communications') THEN
    DELETE FROM public.office_locations WHERE name = 'IT & Communications';
    UPDATE public.office_locations SET department = 'IT and Communications' WHERE name = 'IT and Communications';
  ELSE
    UPDATE public.office_locations SET name = 'IT and Communications', department = 'IT and Communications' WHERE name = 'IT & Communications';
  END IF;

  -- Handle 'Regulatory and Compliance'
  IF EXISTS (SELECT 1 FROM public.office_locations WHERE name = 'Regulatory and Compliance') THEN
    DELETE FROM public.office_locations WHERE name IN ('Legal, Regulatory and Compliance', 'Regulatory & Compliance');
    UPDATE public.office_locations SET department = 'Regulatory and Compliance' WHERE name = 'Regulatory and Compliance';
  ELSE
    UPDATE public.office_locations SET name = 'Regulatory and Compliance', department = 'Regulatory and Compliance' WHERE name IN ('Legal, Regulatory and Compliance', 'Regulatory & Compliance');
  END IF;
END $$;

-- 3. Standardize profiles table text department, lead_departments array, and office_location
UPDATE public.profiles
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR', 'Human Resources');

UPDATE public.profiles
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.profiles
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT', 'Information and Communications Technology', 'Information Technology and Communications');

UPDATE public.profiles
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.profiles
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

-- Standardize profiles.office_location
UPDATE public.profiles
SET office_location = 'Admin and HR'
WHERE office_location = 'Admin & HR';

UPDATE public.profiles
SET office_location = 'Operations and Maintenance'
WHERE office_location IN ('Operations', 'Operations & Maintenance');

UPDATE public.profiles
SET office_location = 'IT and Communications'
WHERE office_location = 'IT & Communications';

UPDATE public.profiles
SET office_location = 'Regulatory and Compliance'
WHERE office_location IN ('Legal, Regulatory and Compliance', 'Regulatory & Compliance');

-- Update lead_departments arrays on profiles
UPDATE public.profiles
SET lead_departments = (
  SELECT array_agg(
    CASE
      WHEN elem IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR', 'Human Resources') THEN 'Admin and HR'
      WHEN elem IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM') THEN 'Operations and Maintenance'
      WHEN elem IN ('IT & Communications', 'ICT', 'IT', 'Information and Communications Technology', 'Information Technology and Communications') THEN 'IT and Communications'
      WHEN elem IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI') THEN 'Business, Growth and Innovation'
      WHEN elem IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG') THEN 'Regulatory and Compliance'
      ELSE elem
    END
  )
  FROM unnest(lead_departments) AS elem
)
WHERE lead_departments IS NOT NULL AND array_length(lead_departments, 1) > 0;

-- Sync department_id FK on profiles with departments table
UPDATE public.profiles p
SET department_id = d.id
FROM public.departments d
WHERE p.department = d.name
  AND (p.department_id IS DISTINCT FROM d.id);

-- 4. Standardize tasks table
UPDATE public.tasks
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR');

UPDATE public.tasks
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.tasks
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT');

UPDATE public.tasks
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.tasks
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

-- 5. Standardize goals_objectives table
UPDATE public.goals_objectives
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR');

UPDATE public.goals_objectives
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.goals_objectives
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT');

UPDATE public.goals_objectives
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.goals_objectives
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

-- 6. Standardize help_desk_tickets table
UPDATE public.help_desk_tickets
SET service_department = CASE
  WHEN service_department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR') THEN 'Admin and HR'
  WHEN service_department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM') THEN 'Operations and Maintenance'
  WHEN service_department IN ('IT & Communications', 'ICT', 'IT') THEN 'IT and Communications'
  WHEN service_department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI') THEN 'Business, Growth and Innovation'
  WHEN service_department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG') THEN 'Regulatory and Compliance'
  ELSE service_department
END,
requester_department = CASE
  WHEN requester_department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR') THEN 'Admin and HR'
  WHEN requester_department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM') THEN 'Operations and Maintenance'
  WHEN requester_department IN ('IT & Communications', 'ICT', 'IT') THEN 'IT and Communications'
  WHEN requester_department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI') THEN 'Business, Growth and Innovation'
  WHEN requester_department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG') THEN 'Regulatory and Compliance'
  ELSE requester_department
END;

-- 7. Standardize assets & asset_assignments tables
UPDATE public.assets
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR');

UPDATE public.assets
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.assets
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT');

UPDATE public.assets
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.assets
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

UPDATE public.assets
SET office_location = 'Admin and HR'
WHERE office_location = 'Admin & HR';

UPDATE public.assets
SET office_location = 'Operations and Maintenance'
WHERE office_location IN ('Operations', 'Operations & Maintenance');

UPDATE public.assets
SET office_location = 'IT and Communications'
WHERE office_location = 'IT & Communications';

UPDATE public.assets
SET office_location = 'Regulatory and Compliance'
WHERE office_location IN ('Legal, Regulatory and Compliance', 'Regulatory & Compliance');

UPDATE public.asset_assignments
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR');

UPDATE public.asset_assignments
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.asset_assignments
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT');

UPDATE public.asset_assignments
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.asset_assignments
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

-- Recreate check constraints on assets & profiles
ALTER TABLE public.assets ADD CONSTRAINT assets_department_check CHECK (
  department IS NULL OR department = ANY (ARRAY[
    'Accounts',
    'Admin and HR',
    'Business, Growth and Innovation',
    'Corporate Services',
    'Executive Management',
    'IT and Communications',
    'Logistics',
    'Monitoring and Evaluation',
    'Operations and Maintenance',
    'Project',
    'Quality Assurance',
    'Regulatory and Compliance',
    'SIWES',
    'Stakeholder Engagement',
    'Technical'
  ])
);

ALTER TABLE public.assets ADD CONSTRAINT assets_office_location_check CHECK (
  office_location IS NULL OR office_location = ANY (ARRAY[
    'Accounts',
    'Admin and HR',
    'Assistant Executive Director',
    'Business, Growth and Innovation',
    'Corporate Services',
    'Executive Management',
    'General Conference Room',
    'IT and Communications',
    'Kitchen',
    'Legal, Regulatory and Compliance',
    'Logistics',
    'MD Conference Room',
    'MD Office',
    'Monitoring and Evaluation',
    'Office',
    'Operations and Maintenance',
    'Project',
    'Quality Assurance',
    'Reception',
    'Regulatory and Compliance',
    'SIWES',
    'Site',
    'Stakeholder Engagement',
    'Technical',
    'Technical Extension'
  ])
);

-- Recreate the profiles office_location check that was dropped in step 0.
-- Mirrors assets_office_location_check: every value the old (narrower) constraint
-- permitted is either present below or was rewritten into a permitted value above.
ALTER TABLE public.profiles ADD CONSTRAINT profiles_office_location_check CHECK (
  office_location IS NULL OR office_location = ANY (ARRAY[
    'Accounts',
    'Admin and HR',
    'Assistant Executive Director',
    'Business, Growth and Innovation',
    'Corporate Services',
    'Executive Management',
    'General Conference Room',
    'IT and Communications',
    'Kitchen',
    'Legal, Regulatory and Compliance',
    'Logistics',
    'MD Conference Room',
    'MD Office',
    'Monitoring and Evaluation',
    'Office',
    'Operations and Maintenance',
    'Project',
    'Quality Assurance',
    'Reception',
    'Regulatory and Compliance',
    'SIWES',
    'Site',
    'Stakeholder Engagement',
    'Technical',
    'Technical Extension'
  ])
);

-- 8. Standardize cbt_questions table
UPDATE public.cbt_questions
SET department = 'Admin and HR'
WHERE department IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR');

UPDATE public.cbt_questions
SET department = 'Operations and Maintenance'
WHERE department IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM');

UPDATE public.cbt_questions
SET department = 'IT and Communications'
WHERE department IN ('IT & Communications', 'ICT', 'IT');

UPDATE public.cbt_questions
SET department = 'Business, Growth and Innovation'
WHERE department IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI');

UPDATE public.cbt_questions
SET department = 'Regulatory and Compliance'
WHERE department IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG');

-- 9. Standardize correspondence_records table if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'correspondence_records') THEN
    UPDATE public.correspondence_records
    SET department_name = CASE
      WHEN department_name IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR') THEN 'Admin and HR'
      WHEN department_name IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM') THEN 'Operations and Maintenance'
      WHEN department_name IN ('IT & Communications', 'ICT', 'IT') THEN 'IT and Communications'
      WHEN department_name IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI') THEN 'Business, Growth and Innovation'
      WHEN department_name IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG') THEN 'Regulatory and Compliance'
      ELSE department_name
    END,
    assigned_department_name = CASE
      WHEN assigned_department_name IN ('Admin & HR', 'Admin/HR', 'HR', 'Administration & HR', 'Administration and HR') THEN 'Admin and HR'
      WHEN assigned_department_name IN ('Operations & Maintenance', 'Operations', 'O&M', 'OPM') THEN 'Operations and Maintenance'
      WHEN assigned_department_name IN ('IT & Communications', 'ICT', 'IT') THEN 'IT and Communications'
      WHEN assigned_department_name IN ('Business Growth and Innovation', 'Business Growth & Innovation', 'Business, Growth & Innovation', 'BGI') THEN 'Business, Growth and Innovation'
      WHEN assigned_department_name IN ('Legal, Regulatory and Compliance', 'Legal, Regulatory & Compliance', 'Regulatory & Compliance', 'Legal/Regulatory', 'Legal Regulatory and Compliance', 'LRC', 'REG') THEN 'Regulatory and Compliance'
      ELSE assigned_department_name
    END;
  END IF;
END $$;

-- 10. Update SQL helper function: normalize_department_name
CREATE OR REPLACE FUNCTION public.normalize_department_name(p_department text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_department IS NULL THEN NULL
    WHEN lower(trim(p_department)) IN ('finance') THEN 'Accounts'
    WHEN lower(trim(p_department)) IN ('admin & hr', 'admin/hr', 'hr', 'administration & hr', 'administration and hr', 'admin and hr', 'human resources') THEN 'Admin and HR'
    WHEN lower(trim(p_department)) IN ('operations', 'operations & maintenance', 'operations and maintenance', 'o&m', 'opm') THEN 'Operations and Maintenance'
    WHEN lower(trim(p_department)) IN ('it & communications', 'it and communications', 'ict', 'it', 'information and communications technology', 'information technology and communications') THEN 'IT and Communications'
    WHEN lower(trim(p_department)) IN ('business growth and innovation', 'business growth & innovation', 'business, growth & innovation', 'business, growth and innovation', 'bgi') THEN 'Business, Growth and Innovation'
    WHEN lower(trim(p_department)) IN ('legal, regulatory and compliance', 'legal, regulatory & compliance', 'regulatory & compliance', 'regulatory and compliance', 'legal/regulatory', 'legal regulatory and compliance', 'lrc', 'reg') THEN 'Regulatory and Compliance'
    ELSE trim(p_department)
  END;
$$;

-- Revoke execute from public/anon and grant to authenticated/service_role
REVOKE EXECUTE ON FUNCTION public.normalize_department_name(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_department_name(text) TO authenticated, service_role;

COMMIT;
