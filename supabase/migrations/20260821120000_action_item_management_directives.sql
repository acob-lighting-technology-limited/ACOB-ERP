-- Management Directives — a second category inside the Action Tracker.
--
-- Action points today come from weekly_reports.tasks_new_week: the weekly report
-- POST route deletes every action_items row carrying that report_id and re-inserts
-- from the parsed text on each submit. Directives raised by management during the
-- general meeting must therefore never carry a report_id, or the next submission
-- would wipe them.
--
-- They are modelled as the same row type (so status handling, carry-forward,
-- exports, the official PDF and department scoping all keep working untouched)
-- separated by `origin`, and surfaced as their own section in the UI rather than
-- being mixed into the department's report-derived list.
--
-- Two fields the weekly flow has no equivalent for:
--   * meeting_date   — the meeting the directive was issued at.
--   * timeline_text  — directives carry free-text deadlines ("Weekly", "Same Week",
--                      "Within 24 hours of unresolved issues", "-"), not the
--                      implicit Sunday-of-week due date the tracker computes.
--
-- Responsible staff are named individuals, often several and across departments
-- ("Ayoola Peter Mobolade, Ilonze Chibuikem Michael"), which `department` alone
-- cannot express — hence action_item_assignees. `department` stays populated so
-- every existing scoping path, RLS policy and grouped view still resolves.

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'weekly_report',
  ADD COLUMN IF NOT EXISTS meeting_date date,
  ADD COLUMN IF NOT EXISTS timeline_text text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'action_items_origin_check'
  ) THEN
    ALTER TABLE public.action_items
      ADD CONSTRAINT action_items_origin_check
      CHECK (origin IN ('weekly_report', 'management_directive'));
  END IF;
END $$;

COMMENT ON COLUMN public.action_items.origin IS
  'weekly_report = derived from weekly_reports.tasks_new_week (owned by the report sync); management_directive = raised by management at the general meeting (never touched by the report sync).';
COMMENT ON COLUMN public.action_items.meeting_date IS 'Meeting the directive was issued at. Null for weekly report action points.';
COMMENT ON COLUMN public.action_items.timeline_text IS 'Free-text timeline as minuted, e.g. "Weekly", "Same Week". Null for weekly report action points.';

CREATE INDEX IF NOT EXISTS action_items_origin_week_idx
  ON public.action_items (origin, week_number, year);

-- ---------------------------------------------------------------------------
-- Responsible staff
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.action_item_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id uuid NOT NULL REFERENCES public.action_items(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT action_item_assignees_unique UNIQUE (action_item_id, profile_id)
);

CREATE INDEX IF NOT EXISTS action_item_assignees_item_idx ON public.action_item_assignees (action_item_id);
CREATE INDEX IF NOT EXISTS action_item_assignees_profile_idx ON public.action_item_assignees (profile_id);

ALTER TABLE public.action_item_assignees ENABLE ROW LEVEL SECURITY;

-- Reads mirror action_items exactly: 20260808140000 made the tracker an org-wide
-- reporting artefact readable by every authenticated user. A responsible-staff
-- name is strictly less sensitive than the directive text it hangs off.
DROP POLICY IF EXISTS "Authenticated can view action item assignees" ON public.action_item_assignees;
CREATE POLICY "Authenticated can view action item assignees"
  ON public.action_item_assignees FOR SELECT
  TO authenticated
  USING (true);

-- Writes follow the parent item's write model: admin-like, or a department lead
-- over the item's department. Staff can read the tracker but not reassign anyone.
DROP POLICY IF EXISTS "Leads and admins can manage action item assignees" ON public.action_item_assignees;
CREATE POLICY "Leads and admins can manage action item assignees"
  ON public.action_item_assignees FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      LEFT JOIN public.action_items ai ON ai.id = action_item_assignees.action_item_id
      WHERE p.id = auth.uid()
        AND (
          lower(trim(p.role::text)) IN ('developer', 'super_admin', 'admin')
          OR (
            p.is_department_lead = true
            AND (
              ai.department = p.department
              OR ai.department = ANY (COALESCE(p.lead_departments, ARRAY[]::text[]))
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      LEFT JOIN public.action_items ai ON ai.id = action_item_assignees.action_item_id
      WHERE p.id = auth.uid()
        AND (
          lower(trim(p.role::text)) IN ('developer', 'super_admin', 'admin')
          OR (
            p.is_department_lead = true
            AND (
              ai.department = p.department
              OR ai.department = ANY (COALESCE(p.lead_departments, ARRAY[]::text[]))
            )
          )
        )
    )
  );

REVOKE ALL ON public.action_item_assignees FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.action_item_assignees TO authenticated;

COMMENT ON TABLE public.action_item_assignees IS
  'Named responsible staff for an action item. Populated for management directives, which are routinely cross-departmental and name several people; weekly report action points stay department-scoped and have no rows here.';
