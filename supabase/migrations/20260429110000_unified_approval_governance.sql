-- Unified approval governance + route access control

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'governance_module_code') THEN
    CREATE TYPE public.governance_module_code AS ENUM ('leave', 'help_desk', 'correspondence', 'pms_kpi');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'governance_approver_resolution_mode') THEN
    CREATE TYPE public.governance_approver_resolution_mode AS ENUM ('fixed_user', 'department_lead', 'rule_based');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'governance_access_path_kind') THEN
    CREATE TYPE public.governance_access_path_kind AS ENUM ('app', 'api');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'governance_access_rule_effect') THEN
    CREATE TYPE public.governance_access_rule_effect AS ENUM ('allow', 'deny');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code public.governance_module_code NOT NULL,
  requester_kind text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, requester_kind, version)
);

CREATE TABLE IF NOT EXISTS public.approval_workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.approval_workflows(id) ON DELETE CASCADE,
  stage_order integer NOT NULL CHECK (stage_order > 0),
  stage_code text NOT NULL,
  stage_name text NOT NULL,
  approver_role_code text,
  approver_resolution_mode public.governance_approver_resolution_mode NOT NULL,
  resolution_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, stage_order),
  UNIQUE (workflow_id, stage_code)
);

CREATE TABLE IF NOT EXISTS public.approval_role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code public.governance_module_code NOT NULL,
  role_code text NOT NULL,
  name text NOT NULL,
  description text,
  default_resolution_mode public.governance_approver_resolution_mode NOT NULL DEFAULT 'rule_based',
  default_resolution_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_code, role_code)
);

CREATE TABLE IF NOT EXISTS public.approval_assignment_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code public.governance_module_code NOT NULL,
  role_code text NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global', 'department', 'office', 'requester_kind')),
  scope_value text,
  requester_kind text,
  is_primary boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz,
  effective_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path_pattern text NOT NULL UNIQUE,
  path_kind public.governance_access_path_kind NOT NULL,
  methods text[] NOT NULL DEFAULT ARRAY['GET']::text[],
  description text,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  updated_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.access_path_role_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_path_id uuid NOT NULL REFERENCES public.access_paths(id) ON DELETE CASCADE,
  role_code text NOT NULL,
  effect public.governance_access_rule_effect NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (access_path_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_approval_workflows_module_kind ON public.approval_workflows(module_code, requester_kind);
CREATE INDEX IF NOT EXISTS idx_approval_workflow_stages_workflow ON public.approval_workflow_stages(workflow_id, stage_order);
CREATE INDEX IF NOT EXISTS idx_access_paths_kind_priority ON public.access_paths(path_kind, priority);
CREATE INDEX IF NOT EXISTS idx_access_path_role_rules_path ON public.access_path_role_rules(access_path_id);

CREATE OR REPLACE FUNCTION public.governance_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_workflows_updated_at ON public.approval_workflows;
CREATE TRIGGER trg_approval_workflows_updated_at BEFORE UPDATE ON public.approval_workflows
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

DROP TRIGGER IF EXISTS trg_approval_workflow_stages_updated_at ON public.approval_workflow_stages;
CREATE TRIGGER trg_approval_workflow_stages_updated_at BEFORE UPDATE ON public.approval_workflow_stages
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

DROP TRIGGER IF EXISTS trg_approval_role_bindings_updated_at ON public.approval_role_bindings;
CREATE TRIGGER trg_approval_role_bindings_updated_at BEFORE UPDATE ON public.approval_role_bindings
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

DROP TRIGGER IF EXISTS trg_approval_assignment_overrides_updated_at ON public.approval_assignment_overrides;
CREATE TRIGGER trg_approval_assignment_overrides_updated_at BEFORE UPDATE ON public.approval_assignment_overrides
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

DROP TRIGGER IF EXISTS trg_access_paths_updated_at ON public.access_paths;
CREATE TRIGGER trg_access_paths_updated_at BEFORE UPDATE ON public.access_paths
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

DROP TRIGGER IF EXISTS trg_access_path_role_rules_updated_at ON public.access_path_role_rules;
CREATE TRIGGER trg_access_path_role_rules_updated_at BEFORE UPDATE ON public.access_path_role_rules
FOR EACH ROW EXECUTE FUNCTION public.governance_set_updated_at();

CREATE OR REPLACE FUNCTION public.governance_admin_like()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin', 'developer')
  );
$$;

CREATE OR REPLACE FUNCTION public.governance_mutator()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'developer')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_path_allowed(
  p_user_role text,
  p_path text,
  p_method text DEFAULT 'GET'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule record;
  v_pattern text;
BEGIN
  IF p_user_role IN ('super_admin', 'developer') THEN
    RETURN true;
  END IF;

  FOR v_rule IN
    SELECT ap.path_pattern, ap.methods, ap.priority, apr.effect
    FROM public.access_paths ap
    JOIN public.access_path_role_rules apr ON apr.access_path_id = ap.id
    WHERE ap.is_active = true
      AND apr.is_active = true
      AND apr.role_code = p_user_role
      AND (
        cardinality(ap.methods) = 0
        OR upper(p_method) = ANY(ap.methods)
      )
    ORDER BY ap.priority ASC, ap.created_at DESC
  LOOP
    v_pattern := replace(v_rule.path_pattern, '*', '%');
    IF p_path LIKE v_pattern THEN
      RETURN v_rule.effect = 'allow';
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workflow_stages(
  p_module_code public.governance_module_code,
  p_requester_kind text
)
RETURNS TABLE (
  workflow_id uuid,
  stage_order integer,
  stage_code text,
  stage_name text,
  approver_role_code text,
  approver_resolution_mode public.governance_approver_resolution_mode,
  resolution_config jsonb
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    aw.id,
    aws.stage_order,
    aws.stage_code,
    aws.stage_name,
    aws.approver_role_code,
    aws.approver_resolution_mode,
    aws.resolution_config
  FROM public.approval_workflows aw
  JOIN public.approval_workflow_stages aws ON aws.workflow_id = aw.id
  WHERE aw.module_code = p_module_code
    AND aw.requester_kind = p_requester_kind
    AND aw.is_active = true
    AND aws.is_active = true
  ORDER BY aws.stage_order ASC;
$$;

CREATE OR REPLACE FUNCTION public.resolve_next_approver(
  p_module_code public.governance_module_code,
  p_requester_kind text,
  p_current_stage_order integer DEFAULT NULL,
  p_department text DEFAULT NULL
)
RETURNS TABLE (
  next_stage_order integer,
  next_stage_code text,
  approver_role_code text,
  approver_user_id uuid,
  resolution_mode public.governance_approver_resolution_mode
)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stage record;
BEGIN
  SELECT
    aws.stage_order,
    aws.stage_code,
    aws.approver_role_code,
    aws.approver_resolution_mode,
    aws.resolution_config
  INTO v_stage
  FROM public.approval_workflows aw
  JOIN public.approval_workflow_stages aws ON aws.workflow_id = aw.id
  WHERE aw.module_code = p_module_code
    AND aw.requester_kind = p_requester_kind
    AND aw.is_active = true
    AND aws.is_active = true
    AND (
      p_current_stage_order IS NULL
      OR aws.stage_order > p_current_stage_order
    )
  ORDER BY aws.stage_order ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_stage.stage_order,
    v_stage.stage_code,
    v_stage.approver_role_code,
    (
      SELECT o.user_id
      FROM public.approval_assignment_overrides o
      WHERE o.module_code = p_module_code
        AND o.role_code = COALESCE(v_stage.approver_role_code, '')
        AND o.is_active = true
        AND (
          o.scope_type = 'global'
          OR (o.scope_type = 'department' AND o.scope_value = p_department)
          OR (o.scope_type = 'requester_kind' AND o.requester_kind = p_requester_kind)
        )
      ORDER BY o.is_primary DESC, o.created_at ASC
      LIMIT 1
    ) AS approver_user_id,
    v_stage.approver_resolution_mode;
END;
$$;

ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_role_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_assignment_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_path_role_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approval_workflows_select" ON public.approval_workflows;
CREATE POLICY "approval_workflows_select" ON public.approval_workflows FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "approval_workflows_mutate" ON public.approval_workflows;
CREATE POLICY "approval_workflows_mutate" ON public.approval_workflows FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

DROP POLICY IF EXISTS "approval_workflow_stages_select" ON public.approval_workflow_stages;
CREATE POLICY "approval_workflow_stages_select" ON public.approval_workflow_stages FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "approval_workflow_stages_mutate" ON public.approval_workflow_stages;
CREATE POLICY "approval_workflow_stages_mutate" ON public.approval_workflow_stages FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

DROP POLICY IF EXISTS "approval_role_bindings_select" ON public.approval_role_bindings;
CREATE POLICY "approval_role_bindings_select" ON public.approval_role_bindings FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "approval_role_bindings_mutate" ON public.approval_role_bindings;
CREATE POLICY "approval_role_bindings_mutate" ON public.approval_role_bindings FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

DROP POLICY IF EXISTS "approval_assignment_overrides_select" ON public.approval_assignment_overrides;
CREATE POLICY "approval_assignment_overrides_select" ON public.approval_assignment_overrides FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "approval_assignment_overrides_mutate" ON public.approval_assignment_overrides;
CREATE POLICY "approval_assignment_overrides_mutate" ON public.approval_assignment_overrides FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

DROP POLICY IF EXISTS "access_paths_select" ON public.access_paths;
CREATE POLICY "access_paths_select" ON public.access_paths FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "access_paths_mutate" ON public.access_paths;
CREATE POLICY "access_paths_mutate" ON public.access_paths FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

DROP POLICY IF EXISTS "access_path_role_rules_select" ON public.access_path_role_rules;
CREATE POLICY "access_path_role_rules_select" ON public.access_path_role_rules FOR SELECT TO authenticated USING (public.governance_admin_like());
DROP POLICY IF EXISTS "access_path_role_rules_mutate" ON public.access_path_role_rules;
CREATE POLICY "access_path_role_rules_mutate" ON public.access_path_role_rules FOR ALL TO authenticated USING (public.governance_mutator()) WITH CHECK (public.governance_mutator());

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active)
SELECT 'leave'::public.governance_module_code, r.requester_kind, 'Leave workflow - ' || r.requester_kind, 'Backfilled from leave_approval_role_routes', true
FROM (
  SELECT DISTINCT requester_kind
  FROM public.leave_approval_role_routes
  WHERE is_active = true
) r
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_workflow_stages (
  workflow_id,
  stage_order,
  stage_code,
  stage_name,
  approver_role_code,
  approver_resolution_mode,
  resolution_config,
  is_active
)
SELECT
  aw.id,
  lar.stage_order,
  'pending_' || lar.approver_role_code,
  initcap(replace(lar.approver_role_code, '_', ' ')),
  lar.approver_role_code,
  'rule_based'::public.governance_approver_resolution_mode,
  '{}'::jsonb,
  lar.is_active
FROM public.leave_approval_role_routes lar
JOIN public.approval_workflows aw
  ON aw.module_code = 'leave'
 AND aw.requester_kind = lar.requester_kind
LEFT JOIN public.approval_workflow_stages aws
  ON aws.workflow_id = aw.id
 AND aws.stage_order = lar.stage_order
WHERE aws.id IS NULL;

INSERT INTO public.approval_workflows (module_code, requester_kind, name, description, is_active)
VALUES
  ('help_desk', 'support', 'Help Desk support workflow', 'Seeded from help_desk staged states', true),
  ('help_desk', 'procurement', 'Help Desk procurement workflow', 'Seeded from help_desk staged states', true),
  ('correspondence', 'outgoing', 'Correspondence outgoing approvals', 'Seeded from correspondence_approvals stages', true),
  ('pms_kpi', 'employee', 'PMS KPI approval workflow', 'Seeded from goals_objectives approval_status', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.approval_workflow_stages (workflow_id, stage_order, stage_code, stage_name, approver_role_code, approver_resolution_mode, resolution_config, is_active)
SELECT aw.id, s.stage_order, s.stage_code, s.stage_name, s.approver_role_code,
  s.approver_resolution_mode::public.governance_approver_resolution_mode,
  '{}'::jsonb, true
FROM public.approval_workflows aw
JOIN (
  VALUES
    ('help_desk','support',1,'pending_lead_review','Lead review','service_department_lead','department_lead'),
    ('help_desk','support',2,'department_assigned','Department assignment','service_department_lead','rule_based'),
    ('help_desk','procurement',1,'pending_approval','Requester department approval','requester_department_lead','department_lead'),
    ('help_desk','procurement',2,'approved_for_procurement','Service department approval','service_department_lead','department_lead'),
    ('correspondence','outgoing',1,'department_lead','Department lead approval','department_lead','department_lead'),
    ('correspondence','outgoing',2,'executive','Executive approval','md','department_lead'),
    ('pms_kpi','employee',1,'pending','Manager approval','department_lead','department_lead')
) AS s(module_code, requester_kind, stage_order, stage_code, stage_name, approver_role_code, approver_resolution_mode)
  ON aw.module_code::text = s.module_code
 AND aw.requester_kind = s.requester_kind
LEFT JOIN public.approval_workflow_stages aws
  ON aws.workflow_id = aw.id
 AND aws.stage_order = s.stage_order
WHERE aws.id IS NULL;

INSERT INTO public.access_paths (path_pattern, path_kind, methods, description, priority, is_active)
VALUES
  ('/admin/governance%', 'app', ARRAY['GET','POST','PUT','PATCH','DELETE'], 'Governance console', 1, true),
  ('/api/admin/governance%', 'api', ARRAY['GET','POST','PUT','PATCH','DELETE'], 'Governance APIs', 1, true)
ON CONFLICT (path_pattern) DO NOTHING;

INSERT INTO public.access_path_role_rules (access_path_id, role_code, effect, is_active)
SELECT ap.id, rr.role_code, rr.effect::public.governance_access_rule_effect, true
FROM public.access_paths ap
CROSS JOIN (VALUES
  ('developer', 'allow'),
  ('super_admin', 'allow'),
  ('admin', 'deny'),
  ('employee', 'deny'),
  ('visitor', 'deny')
) AS rr(role_code, effect)
LEFT JOIN public.access_path_role_rules apr
  ON apr.access_path_id = ap.id
 AND apr.role_code = rr.role_code
WHERE ap.path_pattern IN ('/admin/governance%', '/api/admin/governance%')
  AND apr.id IS NULL;

NOTIFY pgrst, 'reload schema';
