-- Portfolios (/admin/portfolios), Projects (/admin/project) and the Corporate
-- Scorecard (/admin/corporate-scorecard) shipped without route keys, so they
-- resolved to "unknown": role 'admin' could never be granted them and there was
-- no checkbox to try. They now have their own grantable keys.
--
-- security.networkActivity and security.bypassOverride were already grantable in
-- lib/admin/policy-v2.ts but had never been added here, so assigning either one
-- would have violated this constraint.
--
-- Keep in sync with GRANTABLE_ADMIN_ROUTES in lib/admin/policy-v2.ts.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_profiles_admin_routes_allowed;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_profiles_admin_routes_allowed
  CHECK (
    admin_routes IS NULL
    OR admin_routes <@ ARRAY[
      'hr.main','hr.leave','hr.attendance','hr.pms','hr.fleet','hr.resources','hr.pms.cbt.manage',
      'jobdescriptions.main','accounts.main','finance.main','purchasing.main','payroll.main',
      'assets.main','assets.issues','inventory.main',
      'reports.weekly','reports.other','scorecard.main',
      'portfolios.main','projects.main',
      'tasks.main',
      'communications.main','communications.broadcast','communications.meetings',
      'correspondence.main','documentation.main','feedback.main',
      'helpdesk.main','notifications.main','tools.main',
      'settings.main','auditlogs.main',
      'security.networkActivity','security.bypassOverride'
    ]::text[]
  );
