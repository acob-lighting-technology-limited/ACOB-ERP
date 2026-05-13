-- Drop the unused governance control plane.
--
-- These tables + functions were introduced by 20260429110000_unified_approval_governance.sql
-- and 20260430120000_governance_v2_controls.sql to back a configurable approval
-- engine and route allowlist. In practice nothing in the application read them:
--   * lib/hr/leave-routing.ts computes routes from hardcoded stage codes
--   * lib/admin/api-scope.ts handles route authz directly
--   * The Next.js middleware does not consult access_paths
--   * The only consumer of is_path_allowed/get_workflow_stages/resolve_next_approver
--     was the governance simulator at /admin/settings/governance
--
-- The /admin/settings/governance UI, its API routes, and lib/governance/ have all
-- been removed in the same change set. This migration removes the backing schema.

BEGIN;

-- Drop tables FIRST. CASCADE handles their triggers, policies, indexes, and
-- the FKs between them. This must happen before the helper functions because
-- the row-level policies reference governance_mutator()/governance_admin_like().
DROP TABLE IF EXISTS public.access_path_role_rules CASCADE;
DROP TABLE IF EXISTS public.access_paths CASCADE;
DROP TABLE IF EXISTS public.approval_assignment_overrides CASCADE;
DROP TABLE IF EXISTS public.approval_role_bindings CASCADE;
DROP TABLE IF EXISTS public.approval_workflow_stages CASCADE;
DROP TABLE IF EXISTS public.approval_workflows CASCADE;

-- RPCs callable only by the governance simulator (now also deleted).
-- The first two reference the governance_module_code enum; drop those before
-- the type drop so the type drop doesn't need CASCADE.
DROP FUNCTION IF EXISTS public.resolve_next_approver(governance_module_code, text, integer, text);
DROP FUNCTION IF EXISTS public.get_workflow_stages(governance_module_code, text);
DROP FUNCTION IF EXISTS public.is_path_allowed(text, text, text);

-- Internal helpers used by the RLS policies on the tables above.
DROP FUNCTION IF EXISTS public.governance_mutator();
DROP FUNCTION IF EXISTS public.governance_admin_like();
DROP FUNCTION IF EXISTS public.governance_set_updated_at() CASCADE;

-- Enum types declared by the governance migration.
DROP TYPE IF EXISTS public.governance_access_rule_effect;
DROP TYPE IF EXISTS public.governance_access_path_kind;
DROP TYPE IF EXISTS public.governance_approver_resolution_mode;
DROP TYPE IF EXISTS public.governance_module_code;

COMMIT;
