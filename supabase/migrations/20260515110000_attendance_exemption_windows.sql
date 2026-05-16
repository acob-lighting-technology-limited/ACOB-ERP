ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_exempt_until date,
  ADD COLUMN IF NOT EXISTS attendance_exempt_reason text,
  ADD COLUMN IF NOT EXISTS attendance_exempt_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_exempt_set_by uuid REFERENCES public.profiles(id);

