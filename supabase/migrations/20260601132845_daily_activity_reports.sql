-- Daily Activity Report (DAR) — self-authored daily work log.
-- Each employee records, per day, the tasks they worked on with a status
-- (not_started / in_progress / completed) and a type (planned / unforeseen).
-- This is distinct from the lead-assigned `tasks` module: the DAR is the
-- employee's own bottom-up record. Two derived metrics — total completed and
-- unforeseen-completed — are computed in the API, never stored here.

-- =====================================================
-- 1. TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.daily_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_date      date NOT NULL,
  status           varchar(20) NOT NULL DEFAULT 'draft', -- draft | submitted
  submitted_at     timestamptz,
  acknowledged_by  uuid REFERENCES public.profiles(id),
  acknowledged_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, report_date)
);

CREATE TABLE IF NOT EXISTS public.daily_report_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       uuid NOT NULL REFERENCES public.daily_reports(id) ON DELETE CASCADE,
  description     text NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'not_started', -- not_started | in_progress | completed
  task_type       varchar(20),                                -- planned | unforeseen | NULL
  comments        text,
  position        integer NOT NULL DEFAULT 0,
  -- Reserved for a future link to a lead-assigned task in the `tasks` module.
  -- Kept as a plain column (no FK) so the DAR stays decoupled from /tasks for v1.
  source_task_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_reports_user_date ON public.daily_reports (user_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_reports_date ON public.daily_reports (report_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_report_tasks_report ON public.daily_report_tasks (report_id, position);

-- =====================================================
-- 2. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_report_tasks ENABLE ROW LEVEL SECURITY;

-- Drop-if-exists guards keep this migration safely re-runnable (CREATE POLICY is not idempotent).
DROP POLICY IF EXISTS "Users can view own daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Department leads can view department daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Admins can view all daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can create own daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can update own unacknowledged daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Admins and leads can acknowledge daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "Users can delete own daily reports" ON public.daily_reports;
DROP POLICY IF EXISTS "View daily report tasks via parent" ON public.daily_report_tasks;
DROP POLICY IF EXISTS "Manage own daily report tasks" ON public.daily_report_tasks;

-- ---- daily_reports ----

-- Employees can see their own reports
CREATE POLICY "Users can view own daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Department leads can view their department's reports
CREATE POLICY "Department leads can view department daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p2.id = daily_reports.user_id
      WHERE p1.id = (SELECT auth.uid())
        AND p1.is_department_lead = true
        AND p1.department_id = p2.department_id
        AND p1.department_id IS NOT NULL
    )
  );

-- Admins can view all reports
CREATE POLICY "Admins can view all daily reports"
  ON public.daily_reports FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid())
        AND role IN ('admin', 'super_admin')
    )
  );

-- Employees can create their own reports
CREATE POLICY "Users can create own daily reports"
  ON public.daily_reports FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Employees can edit their own reports until they have been acknowledged
CREATE POLICY "Users can update own unacknowledged daily reports"
  ON public.daily_reports FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id AND acknowledged_at IS NULL)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Admins / department leads can acknowledge reports they can see
CREATE POLICY "Admins and leads can acknowledge daily reports"
  ON public.daily_reports FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p1
      JOIN public.profiles p2 ON p2.id = daily_reports.user_id
      WHERE p1.id = (SELECT auth.uid())
        AND (
          p1.role IN ('admin', 'super_admin')
          OR (p1.is_department_lead = true AND p1.department_id = p2.department_id AND p1.department_id IS NOT NULL)
        )
    )
  );

-- Employees can delete their own reports
CREATE POLICY "Users can delete own daily reports"
  ON public.daily_reports FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ---- daily_report_tasks ----
-- Visibility / mutation follows the parent report.

CREATE POLICY "View daily report tasks via parent"
  ON public.daily_report_tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_reports r
      WHERE r.id = daily_report_tasks.report_id
        AND (
          r.user_id = (SELECT auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.profiles p1
            JOIN public.profiles p2 ON p2.id = r.user_id
            WHERE p1.id = (SELECT auth.uid())
              AND (
                p1.role IN ('admin', 'super_admin')
                OR (p1.is_department_lead = true AND p1.department_id = p2.department_id AND p1.department_id IS NOT NULL)
              )
          )
        )
    )
  );

CREATE POLICY "Manage own daily report tasks"
  ON public.daily_report_tasks FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.daily_reports r
      WHERE r.id = daily_report_tasks.report_id
        AND r.user_id = (SELECT auth.uid())
        AND r.acknowledged_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.daily_reports r
      WHERE r.id = daily_report_tasks.report_id
        AND r.user_id = (SELECT auth.uid())
    )
  );

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
