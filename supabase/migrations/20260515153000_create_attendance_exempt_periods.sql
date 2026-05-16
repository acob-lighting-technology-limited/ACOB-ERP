CREATE TABLE IF NOT EXISTS public.attendance_exempt_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weekly', 'monthly')),
  reason text NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attendance_exempt_periods_user_date
  ON public.attendance_exempt_periods (user_id, start_date, end_date);
