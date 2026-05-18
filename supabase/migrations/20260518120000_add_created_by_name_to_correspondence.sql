-- Add created_by_name to correspondence_records.
-- This denormalises the display name of the logged-in user who submitted the
-- record, which may differ from sender_name / originator_id when an admin
-- creates a record on behalf of someone else.
ALTER TABLE public.correspondence_records
  ADD COLUMN IF NOT EXISTS created_by_name TEXT;

-- Backfill from profiles for existing rows that have a created_by_id.
UPDATE public.correspondence_records r
SET created_by_name = COALESCE(
  NULLIF(TRIM(p.full_name), ''),
  NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), '')
)
FROM public.profiles p
WHERE p.id = r.created_by_id
  AND r.created_by_name IS NULL;
