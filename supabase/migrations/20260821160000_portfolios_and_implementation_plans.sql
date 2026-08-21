-- ─────────────────────────────────────────────────────────────
-- Portfolio → Project → Implementation Plan → Task
--
-- A portfolio is a parent grouping for related projects (a programme,
-- funding arrangement, client, or strategic initiative) — e.g. MST
-- holding the Ogufa, Umaisha, Musha, Tunga and Kyakale mini-grids.
--
-- An implementation plan is a folder inside a project ("Civil Works",
-- "Installation") that groups its tasks. It deliberately carries no
-- weight of its own: task weight alone decides project progress, so
-- there is only ever one layer of weighting to explain.
--
-- Tasks are NOT created here. They live in public.tasks exactly as
-- department tasks do, tagged with project_id/plan_id — one row, read
-- from both the project dashboard and the assignee's KPI, which is why
-- project work cannot be double-counted.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.portfolios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text,
  description text,
  status      text NOT NULL DEFAULT 'active',
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolios_status_check CHECK (status IN ('active', 'on_hold', 'closed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolios_code_unique
  ON public.portfolios (lower(code))
  WHERE code IS NOT NULL;

COMMENT ON TABLE public.portfolios IS 'Parent grouping for related projects (programme, client, or funding arrangement).';

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS portfolio_id uuid REFERENCES public.portfolios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_portfolio_id ON public.projects (portfolio_id);

CREATE TABLE IF NOT EXISTS public.implementation_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_implementation_plans_project
  ON public.implementation_plans (project_id, sort_order);

COMMENT ON TABLE public.implementation_plans IS 'Grouping folder for a project''s tasks. Carries no weight of its own.';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.implementation_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON public.tasks (plan_id) WHERE is_archived = false;

COMMENT ON COLUMN public.tasks.plan_id IS 'Implementation plan this task sits under. Grouping only — weight drives scoring.';

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.implementation_plans ENABLE ROW LEVEL SECURITY;

-- Portfolios are an organisational index, not sensitive content: any
-- authenticated user may read them so a project's parent renders, while
-- only admins may change them.
DROP POLICY IF EXISTS "Portfolios select authenticated" ON public.portfolios;
CREATE POLICY "Portfolios select authenticated"
ON public.portfolios FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Portfolios write admin" ON public.portfolios;
CREATE POLICY "Portfolios write admin"
ON public.portfolios FOR ALL TO authenticated
USING (public.is_admin_like())
WITH CHECK (public.is_admin_like());

-- A plan is visible to whoever can see its project, and editable by
-- whoever can manage it — the project manager, in practice.
DROP POLICY IF EXISTS "Implementation plans select scoped" ON public.implementation_plans;
CREATE POLICY "Implementation plans select scoped"
ON public.implementation_plans FOR SELECT TO authenticated
USING (
  public.is_admin_like()
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = implementation_plans.project_id
      AND (
        p.created_by = auth.uid()
        OR p.project_manager_id = auth.uid()
        OR public.is_project_member(p.id, auth.uid())
      )
  )
  -- Someone working a task under this plan must be able to see the plan.
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.plan_id = implementation_plans.id
      AND t.assigned_to = auth.uid()
  )
);

DROP POLICY IF EXISTS "Implementation plans write scoped" ON public.implementation_plans;
CREATE POLICY "Implementation plans write scoped"
ON public.implementation_plans FOR ALL TO authenticated
USING (public.can_manage_project(project_id))
WITH CHECK (public.can_manage_project(project_id));

-- Assignees could not previously see the project their own task belonged
-- to, which left the project name blank on their task and PMS views.
DROP POLICY IF EXISTS "Projects select scoped" ON public.projects;
CREATE POLICY "Projects select scoped"
ON public.projects FOR SELECT TO authenticated
USING (
  public.is_admin_like()
  OR created_by = auth.uid()
  OR project_manager_id = auth.uid()
  OR public.is_project_member(id, auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.project_id = projects.id
      AND t.assigned_to = auth.uid()
  )
);

GRANT SELECT ON public.portfolios TO authenticated;
GRANT SELECT ON public.implementation_plans TO authenticated;

NOTIFY pgrst, 'reload schema';
