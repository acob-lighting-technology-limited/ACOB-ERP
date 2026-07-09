-- Phase 2: remove dead CRM feature remnants from the database.
--
-- CRM was cut from the product. Its tables are already gone, but three orphan
-- functions remained. Two (log_crm_contact_audit, log_crm_opportunity_audit) are
-- SECURITY DEFINER and were still anon-executable via /rest/v1/rpc/* (the last two
-- entries on the Phase 1b exposed-function list). No triggers depend on them.
--
-- Verify after apply:
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.prosecdef AND has_function_privilege('anon',p.oid,'EXECUTE');
--   -- expect: 0 rows

DROP FUNCTION IF EXISTS public.log_crm_contact_audit();
DROP FUNCTION IF EXISTS public.log_crm_opportunity_audit();
DROP FUNCTION IF EXISTS public.update_crm_updated_at();
