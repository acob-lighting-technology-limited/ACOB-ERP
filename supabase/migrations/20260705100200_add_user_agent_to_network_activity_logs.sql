-- Feature 3: Browser/OS from User-Agent. The RouterOS-side pusher (updated
-- separately, outside this repo) does not send user_agent yet — this
-- prepares the ERP side so it's ready once it does. browser/os are parsed
-- once at ingestion time (lib/security/parse-user-agent.ts) and stored
-- alongside the raw string to avoid re-parsing on every read.
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS browser text;
ALTER TABLE public.network_activity_logs ADD COLUMN IF NOT EXISTS os text;
