-- Normalise employment_type across profiles.
--
-- 56 profiles have employment_type NULL. The app already treats NULL as 'full_time' when
-- filtering and when rendering the Employee Type column, so this makes the existing
-- assumption explicit rather than changing behaviour. It also makes the Employees /
-- Contract Staff scope on /admin/hr/employees depend on a value that is actually stored.
--
-- ── NOT done here, deliberately ────────────────────────────────────────────────────────
-- The 46 contract-staff profiles carry employment_status = 'contract', which describes a
-- staff TYPE rather than a lifecycle state and duplicates employment_type. The obvious fix
-- is to set them to 'active', but the CHECK constraint
--
--     profiles_active_company_email_required
--       COALESCE(employment_status,'active') <> 'active'
--       OR NULLIF(btrim(COALESCE(company_email,'')),'') IS NOT NULL
--
-- requires every active profile to have a company email. Those 46 have none, and per the
-- business they never will — their auth emails were fabricated by the 2026-07-23 import and
-- were wiped on 2026-08-19. So 'contract' is currently the only status they can legally hold.
--
-- Resolving that properly means either relaxing the constraint to exempt contract staff or
-- accepting 'contract' as a permanent status value. That decision is pending; until then the
-- UI keys its Employees / Contract Staff scope off employment_type, not status, so nothing
-- user-facing depends on the wart.

BEGIN;

UPDATE public.profiles
SET employment_type = 'full_time'
WHERE employment_type IS NULL;

COMMIT;
