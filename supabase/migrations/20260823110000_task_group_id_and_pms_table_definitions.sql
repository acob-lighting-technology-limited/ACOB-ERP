-- ─────────────────────────────────────────────────────────────
-- 1. Multi-assign fan-out: link the siblings.
--
-- Assigning one piece of work to three people writes three independent
-- task rows. The lead believes they created ONE task; the system has
-- three, with nothing connecting them. Deleting one leaves the other
-- two on their assignees' lists, which is exactly how "I deleted it and
-- they can still see it" happens.
--
-- group_id ties a fan-out together so the set can be shown, edited and
-- archived as the single thing the lead thinks it is. Each row keeps
-- its own weight, rating and status — the individuals are still scored
-- individually.
--
-- 2. The four PMS tables that exist in production but were never in a
--    migration, so a fresh environment comes up without them.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS group_id uuid;

COMMENT ON COLUMN public.tasks.group_id IS
  'Shared by every row of one multi-assign fan-out. NULL for single-assignee tasks.';

CREATE INDEX IF NOT EXISTS idx_tasks_group_id ON public.tasks (group_id) WHERE group_id IS NOT NULL;

-- Backfill: rows created in the same instant, by the same person, with the
-- same title and department are a fan-out. created_at is identical to the
-- microsecond for these because they were inserted in one statement.
WITH fanouts AS (
  SELECT title, department, assigned_by, created_at, gen_random_uuid() AS new_group
  FROM public.tasks
  WHERE assigned_by IS NOT NULL
  GROUP BY title, department, assigned_by, created_at
  HAVING count(*) > 1
)
UPDATE public.tasks t
SET group_id = f.new_group
FROM fanouts f
WHERE t.group_id IS NULL
  AND t.title = f.title
  AND t.assigned_by = f.assigned_by
  AND t.created_at = f.created_at
  AND t.department IS NOT DISTINCT FROM f.department;

-- ─────────────────────────────────────────────────────────────
-- PMS tables missing from source control
--
-- These already exist in production with their policies. The definitions
-- are recorded here so the repository can rebuild the schema from
-- scratch; IF NOT EXISTS makes this a no-op against the live database.
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.competency_frameworks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  label       text NOT NULL,
  description text,
  category    text NOT NULL DEFAULT 'behaviour',
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competency_frameworks_category_check CHECK (category IN ('behaviour', 'leadership', 'core'))
);

CREATE TABLE IF NOT EXISTS public.peer_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  review_cycle_id  uuid REFERENCES public.review_cycles(id) ON DELETE SET NULL,
  score            numeric(5, 2),
  collaboration    numeric(5, 2),
  communication    numeric(5, 2),
  teamwork         numeric(5, 2),
  professionalism  numeric(5, 2),
  comments         text,
  status           text NOT NULL DEFAULT 'draft',
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.development_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  review_id       uuid REFERENCES public.performance_reviews(id) ON DELETE SET NULL,
  review_cycle_id uuid REFERENCES public.review_cycles(id) ON DELETE SET NULL,
  created_by      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  focus_area      text NOT NULL DEFAULT 'general',
  priority        text NOT NULL DEFAULT 'medium',
  status          text NOT NULL DEFAULT 'active',
  target_date     date,
  completed_at    timestamptz,
  progress_pct    numeric(5, 2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.development_plan_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id      uuid NOT NULL REFERENCES public.development_plans(id) ON DELETE CASCADE,
  title        text NOT NULL,
  description  text,
  status       text NOT NULL DEFAULT 'pending',
  due_date     date,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.competency_frameworks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_feedback            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_plans        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_plan_actions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_peer_feedback_subject     ON public.peer_feedback (subject_user_id, review_cycle_id);
CREATE INDEX IF NOT EXISTS idx_development_plans_user    ON public.development_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_development_plan_actions_plan ON public.development_plan_actions (plan_id);

NOTIFY pgrst, 'reload schema';
