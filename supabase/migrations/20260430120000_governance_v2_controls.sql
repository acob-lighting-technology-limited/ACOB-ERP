-- Governance v2: expanded modules + structured stage targets + compatibility aliases

DO $$
BEGIN
  -- Expand enum values if original enum type exists
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'governance_module_code') THEN
    BEGIN
      ALTER TYPE public.governance_module_code ADD VALUE IF NOT EXISTS 'pms_goal_setting';
      ALTER TYPE public.governance_module_code ADD VALUE IF NOT EXISTS 'pms_kpi_scoring';
      ALTER TYPE public.governance_module_code ADD VALUE IF NOT EXISTS 'pms_review';
      ALTER TYPE public.governance_module_code ADD VALUE IF NOT EXISTS 'task';
      ALTER TYPE public.governance_module_code ADD VALUE IF NOT EXISTS 'resource_booking';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
END $$;

ALTER TABLE IF EXISTS public.approval_workflow_stages
  ADD COLUMN IF NOT EXISTS approver_target jsonb NOT NULL DEFAULT '{"target_type":"department_lead"}'::jsonb,
  ADD COLUMN IF NOT EXISTS bypass_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reliever_scope text NOT NULL DEFAULT 'same_department';

ALTER TABLE IF EXISTS public.approval_workflow_stages
  DROP CONSTRAINT IF EXISTS approval_workflow_stages_reliever_scope_check;

ALTER TABLE IF EXISTS public.approval_workflow_stages
  ADD CONSTRAINT approval_workflow_stages_reliever_scope_check
  CHECK (reliever_scope IN ('same_department','cross_department','all_departments','leads_only','everyone'));

-- Backfill v2 target config using existing stage conventions and legacy stage codes
UPDATE public.approval_workflow_stages aws
SET approver_target = CASE
  WHEN aws.stage_code IN ('pending_md', 'lead_executive_management') THEN
    jsonb_build_object('target_type', 'department_lead', 'department_id', d.id)
  WHEN aws.stage_code IN ('hcs', 'lead_corporate_services') THEN
    jsonb_build_object('target_type', 'department_lead', 'department_id', d2.id)
  WHEN aws.approver_resolution_mode = 'department_lead' THEN
    jsonb_build_object('target_type', 'department_lead')
  WHEN aws.approver_role_code IN ('admin','super_admin','developer','employee','visitor') THEN
    jsonb_build_object('target_type', 'role', 'role_code', aws.approver_role_code)
  ELSE
    jsonb_build_object('target_type', 'everyone')
END
FROM public.departments d
LEFT JOIN public.departments d2 ON lower(d2.name) = 'corporate services'
WHERE lower(d.name) = 'executive management';

-- Normalize legacy stage codes to readable stable keys
UPDATE public.approval_workflow_stages
SET stage_code = 'lead_executive_management'
WHERE stage_code = 'pending_md';

UPDATE public.approval_workflow_stages
SET stage_code = 'lead_corporate_services'
WHERE stage_code = 'hcs';

-- Seed representative governance workflows for new modules if absent
INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active, version)
SELECT 'task'::public.governance_module_code, 'employee', 'Task Approval Workflow', 'Task governance workflow', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_workflows WHERE module_code = 'task'::public.governance_module_code AND requester_kind = 'employee' AND version = 1
);

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active, version)
SELECT 'resource_booking'::public.governance_module_code, 'employee', 'Resource Booking Workflow', 'Resource booking governance workflow', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_workflows WHERE module_code = 'resource_booking'::public.governance_module_code AND requester_kind = 'employee' AND version = 1
);

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active, version)
SELECT 'pms_goal_setting'::public.governance_module_code, 'employee', 'PMS Goal Setting Workflow', 'PMS goal-setting governance workflow', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_workflows WHERE module_code = 'pms_goal_setting'::public.governance_module_code AND requester_kind = 'employee' AND version = 1
);

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active, version)
SELECT 'pms_kpi_scoring'::public.governance_module_code, 'employee', 'PMS KPI Scoring Workflow', 'PMS KPI scoring governance workflow', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_workflows WHERE module_code = 'pms_kpi_scoring'::public.governance_module_code AND requester_kind = 'employee' AND version = 1
);

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active, version)
SELECT 'pms_review'::public.governance_module_code, 'employee', 'PMS Review Workflow', 'PMS review governance workflow', true, 1
WHERE NOT EXISTS (
  SELECT 1 FROM public.approval_workflows WHERE module_code = 'pms_review'::public.governance_module_code AND requester_kind = 'employee' AND version = 1
);
