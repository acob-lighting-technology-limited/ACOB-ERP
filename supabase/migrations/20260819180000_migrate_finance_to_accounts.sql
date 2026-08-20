-- Migration: Migrate Finance to Accounts
-- 1. Update check_profiles_admin_routes_allowed constraint on profiles table
--    to include 'accounts.main' while retaining 'finance.main' for transition.
-- 2. Backfill profiles.admin_routes from 'finance.main' to 'accounts.main'.
-- 3. Backfill notifications link_url from /admin/finance and /dept/.../finance to accounts.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_profiles_admin_routes_allowed;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_profiles_admin_routes_allowed
  CHECK (
    admin_routes IS NULL
    OR admin_routes <@ ARRAY[
      'hr.main','hr.leave','hr.attendance','hr.pms','hr.fleet','hr.resources','hr.pms.cbt.manage',
      'jobdescriptions.main','accounts.main','finance.main','purchasing.main',
      'assets.main','assets.issues','inventory.main',
      'reports.weekly','reports.other','tasks.main',
      'communications.main','communications.broadcast','communications.meetings',
      'correspondence.main','documentation.main','feedback.main',
      'helpdesk.main','notifications.main','tools.main',
      'settings.main','auditlogs.main','payroll.main'
    ]::text[]
  );

-- Backfill profile admin_routes
UPDATE public.profiles
SET admin_routes = array_replace(admin_routes, 'finance.main', 'accounts.main')
WHERE admin_routes IS NOT NULL AND 'finance.main' = ANY(admin_routes);

-- Backfill notification links
UPDATE public.notifications
SET link_url = replace(link_url, '/admin/finance', '/admin/accounts')
WHERE link_url LIKE '%/admin/finance%';

UPDATE public.notifications
SET link_url = replace(link_url, '/finance', '/accounts')
WHERE link_url LIKE '/dept/%/finance%';
