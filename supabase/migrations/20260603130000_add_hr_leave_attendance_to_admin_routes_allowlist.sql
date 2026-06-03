-- HR grants were split into functional units: Leave (hr.leave) and Attendance
-- (hr.attendance) became independently grantable. Add them to the admin_routes
-- allowlist so assigning them doesn't violate check_profiles_admin_routes_allowed.
-- Keep in sync with GRANTABLE_ADMIN_ROUTES in lib/admin/policy-v2.ts.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS check_profiles_admin_routes_allowed;

ALTER TABLE public.profiles
  ADD CONSTRAINT check_profiles_admin_routes_allowed
  CHECK (
    admin_routes IS NULL
    OR admin_routes <@ ARRAY[
      'hr.main','hr.leave','hr.attendance','hr.pms','hr.fleet','hr.resources','hr.pms.cbt.manage',
      'jobdescriptions.main','finance.main','purchasing.main',
      'assets.main','assets.issues','inventory.main',
      'reports.weekly','reports.other','tasks.main',
      'communications.main','communications.broadcast','communications.meetings',
      'correspondence.main','documentation.main','feedback.main',
      'helpdesk.main','notifications.main','tools.main',
      'settings.main','auditlogs.main'
    ]::text[]
  );
