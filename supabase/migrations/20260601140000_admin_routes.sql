-- Replace domain-based admin permissions with route-level permissions.
-- admin_domains is kept (old migrations reference it) but app logic now uses admin_routes.

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS admin_routes text[];

-- Only grantable route keys are allowed in this column.
ALTER TABLE public.profiles
ADD CONSTRAINT check_profiles_admin_routes_allowed CHECK (
  admin_routes IS NULL OR
  admin_routes <@ ARRAY[
    'hr.main', 'hr.fleet', 'hr.resources', 'hr.pms.cbt.manage',
    'jobdescriptions.main',
    'finance.main', 'purchasing.main',
    'assets.main', 'assets.issues', 'inventory.main',
    'reports.weekly', 'reports.other',
    'tasks.main',
    'communications.main', 'communications.broadcast', 'communications.meetings',
    'correspondence.main', 'documentation.main', 'feedback.main',
    'helpdesk.main', 'notifications.main', 'tools.main'
  ]::text[]
);

-- Backfill: expand each existing admin_domain to its constituent route keys.
WITH domain_route_map(domain_name, route) AS (
  VALUES
    ('hr', 'hr.main'), ('hr', 'jobdescriptions.main'), ('hr', 'hr.fleet'),
    ('hr', 'hr.resources'), ('hr', 'hr.pms.cbt.manage'),
    ('finance', 'finance.main'), ('finance', 'purchasing.main'),
    ('assets', 'assets.main'), ('assets', 'assets.issues'), ('assets', 'inventory.main'),
    ('reports', 'reports.weekly'), ('reports', 'reports.other'),
    ('tasks', 'tasks.main'),
    ('communications', 'communications.main'), ('communications', 'communications.broadcast'),
    ('communications', 'communications.meetings'), ('communications', 'correspondence.main'),
    ('communications', 'documentation.main'), ('communications', 'feedback.main'),
    ('communications', 'helpdesk.main'), ('communications', 'notifications.main'),
    ('communications', 'tools.main')
)
UPDATE public.profiles p
SET admin_routes = subq.routes
FROM (
  SELECT
    p2.id,
    ARRAY_AGG(DISTINCT m.route ORDER BY m.route) AS routes
  FROM public.profiles p2
  CROSS JOIN LATERAL UNNEST(p2.admin_domains) AS d(domain_name)
  JOIN domain_route_map m ON m.domain_name = d.domain_name
  WHERE p2.role = 'admin'
    AND p2.admin_domains IS NOT NULL
    AND array_length(p2.admin_domains, 1) > 0
  GROUP BY p2.id
) subq
WHERE p.id = subq.id;
