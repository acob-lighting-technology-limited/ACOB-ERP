-- Employee network activity log: domains visited via the office MikroTik web
-- proxy, pushed in from the router's own scheduler script. Append-only,
-- high-volume — mirrors the shape/indexing of acobot_logs
-- (supabase/migrations/20260609120000_acobot_logs.sql).

CREATE TABLE IF NOT EXISTS public.network_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  matched_identifier text NOT NULL,
  domain text NOT NULL,
  source_ip text,
  visited_at timestamptz NOT NULL,
  raw_url text,
  device_hostname text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_network_activity_logs_visited_at_desc
  ON public.network_activity_logs (visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_activity_logs_user_visited_desc
  ON public.network_activity_logs (user_id, visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_activity_logs_domain
  ON public.network_activity_logs (domain);

ALTER TABLE public.network_activity_logs ENABLE ROW LEVEL SECURITY;

-- Admin/HR-only read access — mirrors the admin-only branch of the audit_logs
-- policy (supabase/migrations/20251104154238_rbac_and_features.sql:239-245),
-- intentionally WITHOUT the sibling "leads can view their department" policy:
-- this data is admin/HR-only, leads get no access at all, in any department.
DROP POLICY IF EXISTS "super_admin/admin can view network activity logs" ON public.network_activity_logs;
CREATE POLICY "super_admin/admin can view network activity logs"
ON public.network_activity_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  )
);

-- No INSERT/UPDATE/DELETE policy for authenticated — all writes go through
-- service_role only (used server-side by the ingestion route, never by the
-- router/collector directly).
REVOKE ALL ON TABLE public.network_activity_logs FROM anon;
REVOKE ALL ON TABLE public.network_activity_logs FROM authenticated;
GRANT SELECT ON TABLE public.network_activity_logs TO authenticated;
GRANT ALL ON TABLE public.network_activity_logs TO service_role;
