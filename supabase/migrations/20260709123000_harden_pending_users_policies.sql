-- Phase 1e — Harden pending_users RLS.
--
-- Two problems:
--  1. "Pending users insert policy" allowed anon+authenticated INSERT WITH CHECK
--     (true) — anyone with the anon key could inject rows into the onboarding
--     review queue. The only legitimate writer (app/api/public/onboarding-submit)
--     uses the service-role client, which bypasses RLS, so no permissive INSERT
--     policy is needed.
--  2. "Enable read for authenticated users only" (SELECT, qual=true) let ANY
--     authenticated user read every applicant's PII. RLS policies are OR-ed, so
--     this silently overrode the admin-only "Pending users select policy".
--
-- After this migration: only admins can SELECT/UPDATE/DELETE; inserts happen
-- solely via the service role (RLS-exempt). anon/authenticated cannot read or
-- write pending_users at all.

DROP POLICY IF EXISTS "Pending users insert policy" ON public.pending_users;
DROP POLICY IF EXISTS "Enable read for authenticated users only" ON public.pending_users;
