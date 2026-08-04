-- Adds the device MAC address to network_activity_logs. Populated by the
-- RouterOS-side pusher (updated separately, outside this repo) once it
-- starts resolving and including mac_address in its ingestion payload.
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS mac_address text;
