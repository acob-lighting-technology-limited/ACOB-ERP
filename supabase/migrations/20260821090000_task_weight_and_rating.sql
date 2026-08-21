-- ─────────────────────────────────────────────────────────────
-- Task weight & rating
--
-- KPI/Task Performance (70% of the appraisal) moves off "how many
-- tasks were completed" and onto "how much weighted work was done,
-- and how well". Every task carries a compulsory weight (1-10); the
-- rater scores the finished work 1-5 at the point of approval.
--
--   task score      = weight * (rating / 5)
--   employee KPI %  = SUM(weight * rating/5) / SUM(weight) * 100
--
-- Weight is relative, not a percentage: a project's task weights are
-- deliberately NOT constrained to sum to 100, so adding a task never
-- forces a rebalance of the existing ones.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS weight   integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS rating   integer,
  ADD COLUMN IF NOT EXISTS rated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rated_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_weight_check;
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_weight_check CHECK (weight BETWEEN 1 AND 10);

  ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_rating_check;
  ALTER TABLE public.tasks
    ADD CONSTRAINT tasks_rating_check CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
END $$;

COMMENT ON COLUMN public.tasks.weight   IS 'Relative importance 1-10, compulsory. Denominator of the KPI calculation.';
COMMENT ON COLUMN public.tasks.rating   IS 'Rater score 1-5 of the delivered work. NULL until the task is approved.';
COMMENT ON COLUMN public.tasks.rated_by IS 'Project manager (project tasks) or department lead/admin who rated it.';
COMMENT ON COLUMN public.tasks.rated_at IS 'When the rating was recorded.';

-- Existing rows keep the neutral default weight of 5 so no historical
-- score shifts purely because this column arrived.

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_end_date
  ON public.tasks (assigned_to, task_end_date)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_tasks_project_id
  ON public.tasks (project_id)
  WHERE is_archived = false;

-- ─────────────────────────────────────────────────────────────
-- kpi_achievement_summary: same weighted formula as the app, so the
-- goal pages and the PMS score can never disagree.
--
-- Goals are now a reporting grouping only: their weight_pct/priority
-- no longer influence any score (task weight does that job), and a
-- task needs no goal to count.
-- ─────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS public.kpi_achievement_summary CASCADE;

CREATE VIEW public.kpi_achievement_summary AS
SELECT
  g.user_id,
  g.review_cycle_id,
  g.id              AS goal_id,
  g.title           AS goal_title,
  g.approval_status,
  g.target_value,
  g.achieved_value,
  ROUND(
    CASE
      WHEN COALESCE(g.target_value, 0) = 0 THEN 0
      ELSE LEAST(COALESCE(g.achieved_value, 0) / g.target_value * 100, 100)
    END,
    2
  )                 AS goal_progress_pct,
  COUNT(t.id) FILTER (WHERE t.id IS NOT NULL)              AS linked_tasks_total,
  COUNT(t.id) FILTER (WHERE t.status = 'completed')        AS linked_tasks_completed,
  COALESCE(SUM(t.weight), 0)                               AS linked_tasks_weight,
  CASE
    WHEN COALESCE(SUM(t.weight), 0) = 0 THEN
      ROUND(LEAST(COALESCE(g.achieved_value, 0) / NULLIF(g.target_value, 0) * 100, 100), 2)
    ELSE
      ROUND(
        SUM(t.weight * COALESCE(t.rating, 0) / 5.0)::numeric
          / NULLIF(SUM(t.weight), 0) * 100,
        2
      )
  END               AS effective_kpi_pct
FROM public.goals_objectives g
LEFT JOIN public.tasks t
  ON t.goal_id = g.id
 AND t.is_archived = false
 AND t.status NOT IN ('reassigned', 'cancelled')
 -- Awaiting a rating is not the employee's failure: hold the task out
 -- of the calculation rather than scoring it zero while a lead is slow.
 AND NOT (t.status = 'submitted_for_review' AND t.rating IS NULL)
WHERE g.is_archived = false
GROUP BY g.id, g.user_id, g.review_cycle_id, g.title, g.approval_status, g.target_value, g.achieved_value;

GRANT SELECT ON public.kpi_achievement_summary TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
