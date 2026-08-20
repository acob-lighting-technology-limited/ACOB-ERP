-- ─────────────────────────────────────────────────────────────
-- Migration: Revamp Tasks and Goals Workflow
-- ─────────────────────────────────────────────────────────────

-- 1. Extend tasks status check constraint and assignment_type
DO $$
BEGIN
  -- Drop existing status check if present
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_status_check
    CHECK (status IN (
      'pending',
      'in_progress',
      'submitted_for_review',
      'completed',
      'unable_to_complete',
      'reassigned',
      'failed',
      'cancelled'
    ));

  -- Update assignment_type check
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assignment_type_check;
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_assignment_type_check
    CHECK (assignment_type IN ('individual', 'multiple', 'department'));
END $$;

-- 2. Add audit, attribution, and lifecycle columns to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reassigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS unable_to_complete_reason text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS extension_reason text,
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Index for archived status and performance queries
CREATE INDEX IF NOT EXISTS idx_tasks_is_archived ON public.tasks(is_archived);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON public.tasks(created_by);

-- 3. Update goals_objectives table
ALTER TABLE public.goals_objectives
  ALTER COLUMN approval_status SET DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_goals_is_archived ON public.goals_objectives(is_archived);

-- 4. Update kpi_achievement_summary view
DROP VIEW IF EXISTS public.kpi_achievement_summary CASCADE;

CREATE VIEW public.kpi_achievement_summary AS
SELECT
  g.user_id,
  g.review_cycle_id,
  g.id                                             AS goal_id,
  g.title                                          AS goal_title,
  g.approval_status,
  g.target_value,
  g.achieved_value,
  ROUND(
    CASE
      WHEN COALESCE(g.target_value, 0) = 0 THEN 0
      ELSE LEAST(COALESCE(g.achieved_value, 0) / g.target_value * 100, 100)
    END,
    2
  )                                                AS goal_progress_pct,
  COUNT(t.id) FILTER (WHERE t.is_archived = false AND t.status NOT IN ('reassigned', 'cancelled')) AS linked_tasks_total,
  COUNT(t.id) FILTER (WHERE t.is_archived = false AND t.status = 'completed')                      AS linked_tasks_completed,
  CASE
    WHEN COUNT(t.id) FILTER (WHERE t.is_archived = false AND t.status NOT IN ('reassigned', 'cancelled')) = 0 THEN
      ROUND(LEAST(COALESCE(g.achieved_value, 0) / NULLIF(g.target_value, 0) * 100, 100), 2)
    ELSE
      ROUND(
        COUNT(t.id) FILTER (WHERE t.is_archived = false AND t.status = 'completed')::numeric /
        NULLIF(COUNT(t.id) FILTER (WHERE t.is_archived = false AND t.status NOT IN ('reassigned', 'cancelled')), 0) * 100,
        2
      )
  END                                              AS effective_kpi_pct
FROM public.goals_objectives g
LEFT JOIN public.tasks t ON t.goal_id = g.id
WHERE g.is_archived = false
GROUP BY g.id, g.user_id, g.review_cycle_id, g.title, g.approval_status, g.target_value, g.achieved_value;

GRANT SELECT ON public.kpi_achievement_summary TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
