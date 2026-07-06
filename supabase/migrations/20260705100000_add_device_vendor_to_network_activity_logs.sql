-- Feature 1: Device vendor from MAC address. Resolved server-side (via
-- lib/security/mac-vendor.ts) at ingestion time and stored so the read API
-- and export never need to re-derive it.
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS device_vendor text;
