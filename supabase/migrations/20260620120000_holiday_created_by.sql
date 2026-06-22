-- Attribute who added each holiday so the attendance timeline can show provenance.
ALTER TABLE public.holiday_calendar
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
