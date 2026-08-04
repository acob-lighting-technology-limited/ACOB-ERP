-- Tag each auto-synced meeting artifact with the meeting it came from, so the
-- Records table can show/filter by meeting title instead of raw file name.
alter table public.meeting_week_documents
  add column if not exists source_label text;

-- Backfill existing auto-synced artifacts (all from the ACOB General Meeting).
update public.meeting_week_documents
set source_label = 'ACOB GENERAL MEETING'
where document_type in ('attendance', 'transcript')
  and source_label is null;
