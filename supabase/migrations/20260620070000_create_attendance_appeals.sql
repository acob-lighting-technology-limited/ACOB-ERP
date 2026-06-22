CREATE TABLE IF NOT EXISTS public.attendance_appeals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_record_id uuid        REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appeal_date          date        NOT NULL,
  current_status       varchar(50) NOT NULL,
  requested_status     varchar(50) NOT NULL,
  appeal_reason        text        NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,
  resolution_note      text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- Allow re-submission after rejection, but block duplicate pending/approved appeals
CREATE UNIQUE INDEX IF NOT EXISTS appeals_one_active_per_day
  ON public.attendance_appeals (user_id, appeal_date)
  WHERE status IN ('pending', 'approved');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_appeals_user_id ON public.attendance_appeals (user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_appeals_status ON public.attendance_appeals (status);
CREATE INDEX IF NOT EXISTS idx_attendance_appeals_appeal_date ON public.attendance_appeals (appeal_date);

-- RLS
ALTER TABLE public.attendance_appeals ENABLE ROW LEVEL SECURITY;

-- Employees can view and insert their own appeals
CREATE POLICY "employees_select_own_appeals"
  ON public.attendance_appeals FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "employees_insert_own_appeals"
  ON public.attendance_appeals FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Service role handles updates (approvals/rejections via API)
