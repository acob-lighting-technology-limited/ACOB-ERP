-- AcoBot logs now capture conversations from two surfaces: the ERP (authenticated
-- staff) and the public ACOB website (anonymous visitors). Add a `source` discriminator
-- and relax the user/email columns since website visitors have neither.

ALTER TABLE public.acobot_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'erp';

ALTER TABLE public.acobot_logs
  DROP CONSTRAINT IF EXISTS acobot_logs_source_chk;
ALTER TABLE public.acobot_logs
  ADD CONSTRAINT acobot_logs_source_chk CHECK (source IN ('erp', 'website'));

-- Website visitors are anonymous — no auth user, no company email.
ALTER TABLE public.acobot_logs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.acobot_logs ALTER COLUMN email DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_acobot_logs_source_created_desc
  ON public.acobot_logs (source, created_at DESC);

-- The public website is anonymous, so let the `anon` role INSERT — but ONLY
-- website rows, and never with a user_id. It still cannot read anything (no SELECT
-- grant to anon), so this can't leak data. Avoids shipping a service-role key to
-- the website.
DROP POLICY IF EXISTS "Anyone can insert website acobot logs" ON public.acobot_logs;
CREATE POLICY "Anyone can insert website acobot logs"
ON public.acobot_logs
FOR INSERT
TO anon, authenticated
WITH CHECK (source = 'website' AND user_id IS NULL);

GRANT INSERT ON TABLE public.acobot_logs TO anon;

-- Rebuild the enriched view to expose `source`. Drop first because the new column
-- is inserted mid-list, which CREATE OR REPLACE VIEW cannot do.
DROP VIEW IF EXISTS public.acobot_logs_enriched;
CREATE VIEW public.acobot_logs_enriched
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.user_id,
  l.source,
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
