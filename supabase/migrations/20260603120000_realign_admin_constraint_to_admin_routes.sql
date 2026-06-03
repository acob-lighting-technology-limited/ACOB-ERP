-- Admin scoping moved from admin_domains (legacy) to admin_routes
-- (see 20260601140000_admin_routes.sql), but the old check constraint still
-- required a non-empty admin_domains array for the admin role. That blocked
-- every admin profile update because the app only ever sets admin_routes.
-- Realign the DB constraint to the current model: an admin must have at least
-- one admin_route.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_profiles_admin_requires_domains;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_profiles_admin_requires_routes
  CHECK (role <> 'admin'::user_role OR COALESCE(array_length(admin_routes, 1), 0) > 0) NOT VALID;

-- Extend the admin_routes allowlist to include the newly grantable routes
-- (PMS, Settings, Audit Logs). Keep in sync with GRANTABLE_ADMIN_ROUTES in
-- lib/admin/policy-v2.ts.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_profiles_admin_routes_allowed;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_profiles_admin_routes_allowed
  CHECK (
    admin_routes IS NULL
    OR admin_routes <@ ARRAY[
      'hr.main','hr.pms','hr.fleet','hr.resources','hr.pms.cbt.manage',
      'jobdescriptions.main','finance.main','purchasing.main',
      'assets.main','assets.issues','inventory.main',
      'reports.weekly','reports.other','tasks.main',
      'communications.main','communications.broadcast','communications.meetings',
      'correspondence.main','documentation.main','feedback.main',
      'helpdesk.main','notifications.main','tools.main',
      'settings.main','auditlogs.main'
    ]::text[]
  );
