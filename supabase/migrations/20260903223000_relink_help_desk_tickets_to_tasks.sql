-- Land the help desk <-> task linkage that migration 20260320143000 recorded
-- but never applied.
--
-- That migration is present in supabase_migrations.schema_migrations, so the
-- CLI considers it done and will never re-run it, yet none of its objects exist
-- in production: help_desk_tickets.task_id, its index, and the backfill of
-- mirror tasks are all missing. This migration lands them under a new version.
--
-- Deliberate divergence from the original: ticket numbering is NOT unified.
-- The original rewrote generate_help_desk_ticket_number() to draw TSK numbers
-- from work_item_number_seq, but tickets in non-actionable statuses ('new',
-- 'rejected') never become tasks, so each such ticket would burn a number and
-- punch a permanent hole in the task series. Tickets keep their own HD-NNNNNN
-- identity; the link is carried by task_id, and each mirror task gets its own
-- number from the task series.

BEGIN;

-- 1. The missing link column.
ALTER TABLE public.help_desk_tickets
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.help_desk_tickets.task_id IS
  'The mirror task in public.tasks for this ticket. The task carries its own '
  'TSK-NNNNNN number; the ticket keeps its HD-NNNNNN identity.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_help_desk_tickets_task_id
  ON public.help_desk_tickets(task_id)
  WHERE task_id IS NOT NULL;

-- 2. Name the number generator, so callers do not re-inline the sequence.
--    Kept consistent with the hardened search_path style used since 20260315231729.
CREATE OR REPLACE FUNCTION public.generate_work_item_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RETURN 'TSK-' || LPAD(nextval('public.work_item_number_seq')::text, 6, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_work_item_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.work_item_number IS NULL THEN
    NEW.work_item_number := public.generate_work_item_number();
  END IF;
  RETURN NEW;
END;
$$;

-- generate_help_desk_ticket_number() is intentionally left alone: tickets keep
-- the HD- series from help_desk_ticket_number_seq.

-- 3. Backfill mirror tasks for actionable tickets that have none.
--    work_item_number is omitted so trg_assign_work_item_number assigns the
--    next number in the task series. Ordered by ticket age so the numbers
--    follow ticket chronology.
INSERT INTO public.tasks (
  title, description, priority, status, assigned_to, assigned_by, department,
  due_date, started_at, completed_at, created_at, updated_at,
  source_type, source_id, assignment_type
)
SELECT
  hd.title,
  hd.description,
  hd.priority,
  CASE
    WHEN hd.status = 'in_progress' THEN 'in_progress'
    WHEN hd.status IN ('resolved', 'closed') THEN 'completed'
    WHEN hd.status IN ('rejected', 'cancelled') THEN 'cancelled'
    ELSE 'pending'
  END,
  CASE WHEN hd.handling_mode = 'individual' THEN hd.assigned_to ELSE NULL END,
  COALESCE(hd.assigned_by, hd.created_by, hd.requester_id),
  COALESCE(hd.service_department, hd.requester_department),
  (hd.sla_target_at)::date,
  hd.started_at,
  COALESCE(hd.resolved_at, hd.closed_at),
  hd.created_at,
  hd.updated_at,
  'help_desk',
  hd.id,
  CASE
    WHEN hd.handling_mode = 'individual' AND hd.assigned_to IS NOT NULL THEN 'individual'
    ELSE 'department'
  END
FROM public.help_desk_tickets hd
WHERE hd.status IN (
    'department_queue', 'department_assigned', 'assigned', 'in_progress',
    'approved_for_procurement', 'resolved', 'closed'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.source_type = 'help_desk' AND t.source_id = hd.id
  )
ORDER BY hd.created_at, hd.id;

-- 4. Point every ticket at its mirror task.
UPDATE public.help_desk_tickets hd
SET task_id = t.id
FROM public.tasks t
WHERE t.source_type = 'help_desk'
  AND t.source_id = hd.id
  AND hd.task_id IS DISTINCT FROM t.id;

-- 5. Verify: every actionable ticket linked, no mirror task left unnumbered,
--    numbering still contiguous.
DO $$
DECLARE
  v_unlinked  bigint;
  v_unnumbered bigint;
  v_count     bigint;
  v_max       bigint;
BEGIN
  SELECT count(*) INTO v_unlinked
  FROM public.help_desk_tickets hd
  WHERE hd.status IN (
      'department_queue', 'department_assigned', 'assigned', 'in_progress',
      'approved_for_procurement', 'resolved', 'closed')
    AND hd.task_id IS NULL;

  IF v_unlinked > 0 THEN
    RAISE EXCEPTION '% actionable ticket(s) still unlinked. Rolling back.', v_unlinked;
  END IF;

  SELECT count(*) INTO v_unnumbered
  FROM public.tasks WHERE work_item_number IS NULL;

  IF v_unnumbered > 0 THEN
    RAISE EXCEPTION '% task(s) have no work_item_number. Rolling back.', v_unnumbered;
  END IF;

  SELECT count(*), COALESCE(MAX((regexp_replace(work_item_number,'^TSK-',''))::bigint), 0)
  INTO v_count, v_max FROM public.tasks;

  IF v_count <> v_max THEN
    RAISE EXCEPTION
      'Numbering is not contiguous: % tasks, highest number %. Rolling back.', v_count, v_max;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
