-- Feature 4: Bandwidth per employee — a separate, lower-frequency pipeline
-- from the domain-visit log. Pushed by a separate router job (built
-- separately, outside this repo) via app/api/ingest/network-bandwidth.

CREATE TABLE IF NOT EXISTS public.network_bandwidth_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matched_identifier text NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  bytes_in bigint NOT NULL DEFAULT 0,
  bytes_out bigint NOT NULL DEFAULT 0,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_network_bandwidth_snapshots_user_snapshot_desc
  ON public.network_bandwidth_snapshots (user_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_bandwidth_snapshots_identifier_snapshot_desc
  ON public.network_bandwidth_snapshots (matched_identifier, snapshot_at DESC);

ALTER TABLE public.network_bandwidth_snapshots ENABLE ROW LEVEL SECURITY;

-- Mirrors the admin-only SELECT policy on network_activity_logs
-- (supabase/migrations/20260702120000_create_network_activity_logs.sql).
DROP POLICY IF EXISTS "super_admin/admin can view network bandwidth snapshots" ON public.network_bandwidth_snapshots;
CREATE POLICY "super_admin/admin can view network bandwidth snapshots"
ON public.network_bandwidth_snapshots
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  )
);

-- Writes only via service_role (the new ingestion route).
REVOKE ALL ON TABLE public.network_bandwidth_snapshots FROM anon;
REVOKE ALL ON TABLE public.network_bandwidth_snapshots FROM authenticated;
GRANT SELECT ON TABLE public.network_bandwidth_snapshots TO authenticated;
GRANT ALL ON TABLE public.network_bandwidth_snapshots TO service_role;
