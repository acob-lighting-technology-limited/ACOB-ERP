-- Migration: Populate official department emails
-- Description: Sets official departmental contact emails for Admin and HR and standard company departments

UPDATE public.departments
SET email = 'hradmin@acoblighting.com'
WHERE name = 'Admin and HR' AND (email IS NULL OR email = '');

UPDATE public.departments
SET email = 'ict@acoblighting.com'
WHERE name = 'IT and Communications' AND (email IS NULL OR email = '');

UPDATE public.departments
SET email = 'accounts@acoblighting.com'
WHERE name = 'Accounts' AND (email IS NULL OR email = '');

UPDATE public.departments
SET email = 'operations@acoblighting.com'
WHERE name = 'Operations and Maintenance' AND (email IS NULL OR email = '');

UPDATE public.departments
SET email = 'legal@acoblighting.com'
WHERE name = 'Regulatory and Compliance' AND (email IS NULL OR email = '');

UPDATE public.departments
SET email = 'businessgrowth@acoblighting.com'
WHERE name = 'Business, Growth and Innovation' AND (email IS NULL OR email = '');
