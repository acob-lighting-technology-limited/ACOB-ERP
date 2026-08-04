-- Feature 2: Rogue/new-device detection.
--
-- known_devices tracks every MAC address ever seen on the network so the
-- ingestion route can detect first-time-seen devices and fire an admin
-- alert. is_new_device on network_activity_logs marks the specific log row
-- where a MAC was first observed, so the UI can flag it without joining
-- known_devices on every read.

CREATE TABLE IF NOT EXISTS public.known_devices (
  mac_address text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  matched_identifier text
);

ALTER TABLE public.known_devices ENABLE ROW LEVEL SECURITY;

-- Mirrors the admin-only SELECT policy on network_activity_logs
-- (supabase/migrations/20260702120000_create_network_activity_logs.sql) —
-- same admin/HR-only read, no lead access.
DROP POLICY IF EXISTS "super_admin/admin can view known devices" ON public.known_devices;
CREATE POLICY "super_admin/admin can view known devices"
ON public.known_devices
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  )
);

-- No INSERT/UPDATE/DELETE policy for authenticated — all writes go through
-- service_role only (the ingestion route), never the router/collector or
-- browser directly.
REVOKE ALL ON TABLE public.known_devices FROM anon;
REVOKE ALL ON TABLE public.known_devices FROM authenticated;
GRANT SELECT ON TABLE public.known_devices TO authenticated;
GRANT ALL ON TABLE public.known_devices TO service_role;

-- Per-row flag: true only for the very first network_activity_logs row ever
-- created for a given MAC, set at insert time by the ingestion route.
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS is_new_device boolean NOT NULL DEFAULT false;
