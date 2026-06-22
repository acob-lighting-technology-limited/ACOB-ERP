-- Append-only provenance ledger for attendance.
-- attendance_records remains the SSOT for *current state*; this table is the SSOT
-- for *what happened* (device punches, manual edits, appeals, leave/exemption/holiday
-- grants, cron status flips). The per-day timeline and editor attribution read from here.
-- Keyed on (user_id, event_date) so days with no attendance_record (absent/OOS/exempt/
-- holiday) still have a history.

CREATE TABLE IF NOT EXISTS public.attendance_events (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_date           date        NOT NULL,
  attendance_record_id uuid        REFERENCES public.attendance_records(id) ON DELETE SET NULL,
  event_type           text        NOT NULL,
  from_status          text,
  to_status            text,
  source               text,        -- hikvision | self | remote_web | manual | appeal | cron | system
  comment              text,        -- human reason (request/approval/manual/waiver/leave/exemption)
  actor_id             uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata             jsonb,       -- clock times, appeal_id, device employeeNo, old/new values
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_events_user_date
  ON public.attendance_events (user_id, event_date);
CREATE INDEX IF NOT EXISTS idx_attendance_events_record
  ON public.attendance_events (attendance_record_id);
CREATE INDEX IF NOT EXISTS idx_attendance_events_date
  ON public.attendance_events (event_date);
CREATE INDEX IF NOT EXISTS idx_attendance_events_type
  ON public.attendance_events (event_type);

-- RLS: employees may read their own events; all writes and admin reads go through the
-- service role (which bypasses RLS), matching the rest of the attendance API.
ALTER TABLE public.attendance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employees_select_own_attendance_events" ON public.attendance_events;
CREATE POLICY "employees_select_own_attendance_events"
  ON public.attendance_events FOR SELECT
  USING (user_id = auth.uid());
