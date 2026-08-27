-- Multiple disjoint date ranges per leave request (e.g. 1st-3rd and 5th-7th
-- in one submission). leave_requests.start_date/end_date/days_count remain
-- the aggregate (min/max/sum across segments) so every existing reader keeps
-- working unmodified; only the create/edit path and attendance sync need to
-- know about segments.

CREATE TABLE IF NOT EXISTS public.leave_request_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  days_count integer NOT NULL CHECK (days_count > 0),
  segment_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (leave_request_id, segment_order)
);

CREATE INDEX IF NOT EXISTS idx_leave_request_segments_leave_request_id
  ON public.leave_request_segments(leave_request_id);

ALTER TABLE public.leave_request_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leave request segments select policy" ON public.leave_request_segments;
CREATE POLICY "Leave request segments select policy" ON public.leave_request_segments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leave_requests lr
      WHERE lr.id = leave_request_segments.leave_request_id
        AND (
          lr.user_id = auth.uid()
          OR lr.reliever_id = auth.uid()
          OR lr.supervisor_id = auth.uid()
          OR lr.current_approver_user_id = auth.uid()
          OR public.has_role('admin')
        )
    )
  );

DROP POLICY IF EXISTS "Leave request segments manage policy" ON public.leave_request_segments;
CREATE POLICY "Leave request segments manage policy" ON public.leave_request_segments
  FOR ALL TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

NOTIFY pgrst, 'reload schema';
