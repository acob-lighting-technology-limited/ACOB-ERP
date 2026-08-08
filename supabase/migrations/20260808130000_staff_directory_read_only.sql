-- Follow-up to 20260808120000: make staff_directory genuinely read-only.
--
-- Supabase's default privileges grant ALL ON TABLES to authenticated, so the
-- view came into existence with INSERT/UPDATE/DELETE already granted; the
-- GRANT SELECT in the previous migration was a no-op against that. A simple
-- single-table view is auto-updatable, and because the view runs with
-- security_invoker = false those writes would execute as the view owner and
-- bypass profiles RLS — letting any authenticated user modify any profile's
-- directory columns. Revoke first, then grant only SELECT.
--
-- Verify (expect exactly one row: authenticated / SELECT):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='staff_directory'
--     AND grantee IN ('anon','authenticated');

REVOKE ALL ON public.staff_directory FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.staff_directory TO authenticated;

-- Belt and braces: reject writes even if a privilege is ever re-granted by a
-- future default-privilege change. An auto-updatable view stops being
-- auto-updatable once it carries an INSTEAD OF trigger or, as here, is barred
-- by a rule that raises.
CREATE OR REPLACE RULE staff_directory_no_insert AS
  ON INSERT TO public.staff_directory DO INSTEAD NOTHING;
CREATE OR REPLACE RULE staff_directory_no_update AS
  ON UPDATE TO public.staff_directory DO INSTEAD NOTHING;
CREATE OR REPLACE RULE staff_directory_no_delete AS
  ON DELETE TO public.staff_directory DO INSTEAD NOTHING;
