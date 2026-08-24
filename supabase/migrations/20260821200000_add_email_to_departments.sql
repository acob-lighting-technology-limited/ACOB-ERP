-- Migration: Add email column to public.departments
-- Description: Stores official department contact email (e.g., hr@acoblighting.com, ict@acoblighting.com)

ALTER TABLE public.departments
ADD COLUMN IF NOT EXISTS email TEXT;

COMMENT ON COLUMN public.departments.email IS 'Official departmental contact/inbox email address.';
