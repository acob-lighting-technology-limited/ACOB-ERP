-- ─────────────────────────────────────────────────────────────
-- PMS blockers, from the 2026-08-23 audit.
--
-- 1. Employees could not update their own tasks at all: the RLS UPDATE
--    policy allowed only admins and leads, so every status action
--    matched zero rows and surfaced as PostgREST's "Cannot coerce the
--    result to a single JSON object". This blocked the entire
--    submit → approve → rate pipeline.
-- 2. Task weight moves from 1-10 to 1-5.
-- 3. final_score was computed two ways: this function treated a missing
--    component as zero while the app redistributes its weight, so 81 of
--    88 stored scores disagreed with what the dashboard showed.
-- 4. A trigger forced multi-assignee tasks straight to 'completed',
--    skipping the rating the status route now requires.
-- 5. Duplicate review cycles (two active "Q3 2026") made cycle
--    selection non-deterministic between requests.
-- ─────────────────────────────────────────────────────────────

-- ── 1. tasks RLS ─────────────────────────────────────────────
-- The assignee may move their own task through the workflow. The API
-- still decides which transitions are legal and who may approve, rate,
-- reject or reassign; this policy only stops the database rejecting the
-- row outright.

DROP POLICY IF EXISTS "Tasks update policy" ON public.tasks;
CREATE POLICY "Tasks update policy"
ON public.tasks FOR UPDATE TO authenticated
USING (
  (SELECT public.has_role('admin'))
  OR (SELECT public.has_role('lead'))
  OR assigned_to = auth.uid()
  OR assigned_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.task_assignments ta WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid())
  -- A project manager rates the work done on their own project.
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND p.project_manager_id = auth.uid())
)
WITH CHECK (
  (SELECT public.has_role('admin'))
  OR (SELECT public.has_role('lead'))
  OR assigned_to = auth.uid()
  OR assigned_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.task_assignments ta WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND p.project_manager_id = auth.uid())
);

-- SELECT was `USING (true)`: every authenticated user could read every
-- task in the company, including other departments' work.
DROP POLICY IF EXISTS "Tasks select policy" ON public.tasks;
CREATE POLICY "Tasks select policy"
ON public.tasks FOR SELECT TO authenticated
USING (
  (SELECT public.has_role('admin'))
  OR (SELECT public.has_role('lead'))
  OR assigned_to = auth.uid()
  OR assigned_by = auth.uid()
  OR EXISTS (SELECT 1 FROM public.task_assignments ta WHERE ta.task_id = tasks.id AND ta.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tasks.project_id AND p.project_manager_id = auth.uid())
  -- Department-assigned work is visible to that department.
  OR (
    tasks.assignment_type = 'department'
    AND tasks.department IS NOT NULL
    AND tasks.department = (SELECT pr.department FROM public.profiles pr WHERE pr.id = auth.uid())
  )
);

-- ── 2. Weight scale 1-10 → 1-5 ───────────────────────────────
-- Maps the old scale onto the new one keeping relative order:
-- 10,9→5  8,7→4  6,5→3  4,3→2  2,1→1. Leaving the old backfill value of
-- 5 alone would silently promote every legacy task to maximum weight.
--
-- Done in ONE pass on purpose: as sequential updates, a 10 would drop to
-- 5 in the first statement and then be caught again by the rule for 5s
-- and end up at 3.

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_weight_check;

UPDATE public.tasks SET weight = CASE
  WHEN weight >= 9 THEN 5
  WHEN weight >= 7 THEN 4
  WHEN weight >= 5 THEN 3
  WHEN weight >= 3 THEN 2
  ELSE 1
END;

ALTER TABLE public.tasks
  ALTER COLUMN weight SET DEFAULT 3,
  ADD CONSTRAINT tasks_weight_check CHECK (weight BETWEEN 1 AND 5);

COMMENT ON COLUMN public.tasks.weight IS 'Relative importance 1-5, compulsory. Denominator of the KPI calculation.';

-- Legacy work completed before ratings existed is settled at weight 4,
-- rating 4 rather than left unrated, so no task carries the old shape.
UPDATE public.tasks
SET weight = 4, rating = 4, rated_at = now()
WHERE status = 'completed' AND rating IS NULL;

-- ── 3. One formula for final_score ───────────────────────────
-- Mirrors the app: a component with no data has its weight shared out
-- across the components that do, rather than counting as a zero.

CREATE OR REPLACE FUNCTION public.compute_final_performance_score(
  p_kpi_score        numeric,
  p_cbt_score        numeric,
  p_attendance_score numeric,
  p_behaviour_score  numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH parts(value, weight) AS (
    VALUES (p_kpi_score, 70), (p_cbt_score, 10), (p_attendance_score, 10), (p_behaviour_score, 10)
  ),
  present AS (SELECT value, weight FROM parts WHERE value IS NOT NULL)
  SELECT CASE
    WHEN (SELECT COALESCE(SUM(weight), 0) FROM present) = 0 THEN NULL
    ELSE ROUND((SELECT SUM(value * weight) FROM present) / (SELECT SUM(weight) FROM present), 2)
  END;
$function$;

UPDATE public.performance_reviews
SET final_score = public.compute_final_performance_score(kpi_score, cbt_score, attendance_score, behaviour_score);

-- ── 4. Completion trigger must not skip the rating ───────────
-- Everyone marking their part done means the work is delivered, not
-- approved. Sending it to 'completed' here produced completed tasks with
-- no rating, which the KPI calculation then scores as zero.

CREATE OR REPLACE FUNCTION public.update_task_status_from_completions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  task_record tasks%ROWTYPE;
  total_assignments INTEGER;
  completed_count INTEGER;
BEGIN
  SELECT * INTO task_record FROM tasks WHERE id = NEW.task_id;

  IF task_record.assignment_type = 'multiple' THEN
    SELECT COUNT(*) INTO total_assignments FROM task_assignments WHERE task_id = NEW.task_id;
    SELECT COUNT(*) INTO completed_count FROM task_user_completion WHERE task_id = NEW.task_id;

    IF completed_count = total_assignments AND total_assignments > 0 THEN
      UPDATE tasks SET status = 'submitted_for_review' WHERE id = NEW.task_id;
    ELSIF completed_count > 0 THEN
      UPDATE tasks SET status = 'in_progress' WHERE id = NEW.task_id AND status = 'pending';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5. Duplicate review cycles ───────────────────────────────
-- Grouped by window + cadence, not name: "FY 2026 Annual Performance
-- Review" and "FY 2026 Performance Review" are the same annual cycle
-- under two names. Keep whichever row owns data, preferring an active
-- one, then the oldest; re-point children before deleting the rest.

DO $$
DECLARE
  dup RECORD;
  keeper uuid;
BEGIN
  FOR dup IN
    SELECT start_date, end_date, review_type, array_agg(id) AS ids
    FROM public.review_cycles
    GROUP BY start_date, end_date, review_type
    HAVING count(*) > 1
  LOOP
    SELECT rc.id INTO keeper
    FROM public.review_cycles rc
    WHERE rc.id = ANY(dup.ids)
    ORDER BY
      (SELECT count(*) FROM public.performance_reviews r WHERE r.review_cycle_id = rc.id)
      + (SELECT count(*) FROM public.cbt_questions q WHERE q.review_cycle_id = rc.id)
      + (SELECT count(*) FROM public.cbt_attempts a WHERE a.review_cycle_id = rc.id)
      + (SELECT count(*) FROM public.goals_objectives g WHERE g.review_cycle_id = rc.id) DESC,
      (rc.status = 'active') DESC,
      rc.created_at ASC
    LIMIT 1;

    UPDATE public.performance_reviews SET review_cycle_id = keeper WHERE review_cycle_id = ANY(dup.ids) AND review_cycle_id <> keeper;
    UPDATE public.cbt_questions     SET review_cycle_id = keeper WHERE review_cycle_id = ANY(dup.ids) AND review_cycle_id <> keeper;
    UPDATE public.cbt_attempts      SET review_cycle_id = keeper WHERE review_cycle_id = ANY(dup.ids) AND review_cycle_id <> keeper;
    UPDATE public.goals_objectives  SET review_cycle_id = keeper WHERE review_cycle_id = ANY(dup.ids) AND review_cycle_id <> keeper;

    DELETE FROM public.review_cycles WHERE id = ANY(dup.ids) AND id <> keeper;
  END LOOP;
END $$;

-- One cycle per window per cadence, and one active cycle per cadence.
CREATE UNIQUE INDEX IF NOT EXISTS review_cycles_window_unique
  ON public.review_cycles (start_date, end_date, review_type);

CREATE UNIQUE INDEX IF NOT EXISTS review_cycles_one_active_per_type
  ON public.review_cycles (review_type) WHERE status = 'active';

-- ── 6. Indexes for the columns every PMS query filters on ────
CREATE INDEX IF NOT EXISTS idx_performance_reviews_cycle    ON public.performance_reviews (review_cycle_id);
CREATE INDEX IF NOT EXISTS idx_goals_objectives_cycle       ON public.goals_objectives (review_cycle_id);
CREATE INDEX IF NOT EXISTS idx_cbt_attempts_cycle           ON public.cbt_attempts (review_cycle_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by            ON public.tasks (assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_rated_by               ON public.tasks (rated_by);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewed_by            ON public.tasks (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_goals_objectives_approved_by ON public.goals_objectives (approved_by);

NOTIFY pgrst, 'reload schema';
