-- AcoBot conversation log: every question asked to the in-app assistant, its
-- answer, and who asked it — surfaced under the DEV control plane.

CREATE TABLE IF NOT EXISTS public.acobot_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text,
  department text,
  question text NOT NULL,
  answer text,
  had_context boolean NOT NULL DEFAULT false,
  model text,
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acobot_logs_created_at_desc
  ON public.acobot_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_acobot_logs_user_created_desc
  ON public.acobot_logs (user_id, created_at DESC);

ALTER TABLE public.acobot_logs ENABLE ROW LEVEL SECURITY;

-- Developers (DEV control plane) can read every log.
DROP POLICY IF EXISTS "Developer can read acobot logs" ON public.acobot_logs;
CREATE POLICY "Developer can read acobot logs"
ON public.acobot_logs
FOR SELECT
TO authenticated
USING (public.has_role('developer'));

-- A signed-in user may only insert their own log rows.
DROP POLICY IF EXISTS "Authenticated users can write own acobot logs" ON public.acobot_logs;
CREATE POLICY "Authenticated users can write own acobot logs"
ON public.acobot_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

REVOKE ALL ON TABLE public.acobot_logs FROM anon;
REVOKE ALL ON TABLE public.acobot_logs FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.acobot_logs TO authenticated;
GRANT ALL ON TABLE public.acobot_logs TO service_role;

-- Enriched read surface — fills in person/department from profiles at read time.
CREATE OR REPLACE VIEW public.acobot_logs_enriched
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.user_id,
  l.email,
  COALESCE(NULLIF(l.full_name, ''), NULLIF(p.full_name, ''), concat_ws(' ', p.first_name, p.last_name), l.email) AS full_name,
  COALESCE(NULLIF(l.role, ''), p.role::text) AS role,
  COALESCE(NULLIF(l.department, ''), p.department) AS department,
  l.question,
  l.answer,
  l.had_context,
  l.model,
  l.ip_address,
  l.user_agent,
  l.metadata,
  l.created_at
FROM public.acobot_logs l
LEFT JOIN public.profiles p ON p.id = l.user_id;

GRANT SELECT ON public.acobot_logs_enriched TO authenticated, service_role;
