-- Migration: Add SIWES Office Location and Update Check Constraints
-- Description: Inserts the SIWES office location and updates assets constraints to support it.

-- 1. Insert office location if not exists
INSERT INTO public.office_locations (name, type, department, description, is_active, site)
VALUES ('SIWES', 'department_office', 'SIWES', 'SIWES Department Office', true, 'Head Office')
ON CONFLICT (name) DO NOTHING;

-- 2. Recreate assets_office_location_check to support new locations
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_office_location_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_office_location_check CHECK (
  office_location IS NULL OR office_location = ANY (ARRAY[
    'Accounts',
    'Admin & HR',
    'Assistant Executive Director',
    'Business, Growth and Innovation',
    'Corporate Services',
    'Executive Management',
    'General Conference Room',
    'IT and Communications',
    'Kitchen',
    'Legal, Regulatory and Compliance',
    'MD Conference Room',
    'MD Office',
    'Operations',
    'Operations and Maintenance',
    'Project',
    'Reception',
    'Regulatory and Compliance',
    'Site',
    'SIWES',
    'Technical',
    'Technical Extension'
  ])
);

-- 3. Recreate assets_department_check to support new departments
ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_department_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_department_check CHECK (
  department IS NULL OR department = ANY (ARRAY[
    'Accounts',
    'Admin & HR',
    'Business, Growth and Innovation',
    'Corporate Services',
    'Executive Management',
    'IT and Communications',
    'Legal, Regulatory and Compliance',
    'Logistics',
    'Monitoring and Evaluation',
    'Operations',
    'Operations and Maintenance',
    'Project',
    'Quality Assurance',
    'Quality Assurance ',
    'Regulatory and Compliance',
    'SIWES',
    'Stakeholder Engagement',
    'Technical'
  ])
);
