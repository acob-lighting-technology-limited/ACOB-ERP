-- Renumber tasks.work_item_number to a contiguous TSK-NNNNNN series.
--
-- Why: three earlier migrations each re-numbered every existing row with
-- nextval() instead of filling only NULLs, so the sequence ran to 1660 while
-- only 183 real tasks exist. Numbers started at TSK-000666, which reads as if
-- the system holds ~1,600 historical tasks. Nothing is missing -- the counter
-- simply ran ahead.
--
-- Scope: public.tasks only. help_desk_tickets uses a separate HD- sequence in
-- production (the unify_help_desk_with_tasks migration is not applied there),
-- so ticket numbers are untouched.
--
-- Renumbering is chronological by (created_at, id), so TSK-000001 is the
-- oldest task.

BEGIN;

-- Keep the renumber invisible: no updated_at churn, no audit-log noise.
ALTER TABLE public.tasks DISABLE TRIGGER update_tasks_updated_at;
ALTER TABLE public.tasks DISABLE TRIGGER audit_tasks_changes;

-- Record the old -> new mapping before anything changes, so the renumber can be
-- reversed or audited. 183 rows; keep it indefinitely.
CREATE TABLE IF NOT EXISTS public.tasks_work_item_number_backup (
  task_id           uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  old_work_item_number text NOT NULL,
  new_work_item_number text NOT NULL,
  task_created_at   timestamptz,
  backed_up_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tasks_work_item_number_backup IS
  'Old -> new work_item_number mapping from the 2026-09-03 renumber migration. '
  'Reversal: UPDATE tasks t SET work_item_number = b.old_work_item_number '
  'FROM tasks_work_item_number_backup b WHERE t.id = b.task_id.';

ALTER TABLE public.tasks_work_item_number_backup ENABLE ROW LEVEL SECURITY;

-- No policies: this is an operator-only audit table. service_role bypasses RLS;
-- anon and authenticated get nothing.

INSERT INTO public.tasks_work_item_number_backup
  (task_id, old_work_item_number, new_work_item_number, task_created_at)
SELECT id,
       work_item_number,
       'TSK-' || LPAD((ROW_NUMBER() OVER (ORDER BY created_at, id))::text, 6, '0'),
       created_at
FROM public.tasks
ON CONFLICT (task_id) DO NOTHING;

-- Phase 1: park every row on a temporary value. tasks.work_item_number carries
-- a UNIQUE index, and doing this in two phases means the new range can never
-- collide with the old one regardless of what numbers are currently in use.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM public.tasks
)
UPDATE public.tasks t
SET work_item_number = 'TMP-' || ordered.rn::text
FROM ordered
WHERE t.id = ordered.id;

-- Phase 2: settle on the final TSK-NNNNNN values.
UPDATE public.tasks
SET work_item_number = 'TSK-' || LPAD(
  regexp_replace(work_item_number, '^TMP-', '')::text, 6, '0'
)
WHERE work_item_number LIKE 'TMP-%';

-- Point the sequence at the next free number so new tasks continue the series.
DO $$
DECLARE
  v_max bigint;
BEGIN
  SELECT COALESCE(MAX((regexp_replace(work_item_number, '^TSK-', ''))::bigint), 0)
  INTO v_max
  FROM public.tasks
  WHERE work_item_number ~ '^TSK-[0-9]+$';

  IF v_max > 0 THEN
    PERFORM setval('public.work_item_number_seq', v_max, true);
  ELSE
    PERFORM setval('public.work_item_number_seq', 1, false);
  END IF;
END;
$$;

ALTER TABLE public.tasks ENABLE TRIGGER audit_tasks_changes;
ALTER TABLE public.tasks ENABLE TRIGGER update_tasks_updated_at;

-- Guard against a repeat: any future backfill of this column must be scoped to
-- rows that do not already have a number. Never re-run nextval() over rows that
-- are already numbered -- that is what burned 1,477 values the first time.
COMMENT ON COLUMN public.tasks.work_item_number IS
  'Human-readable identifier in format TSK-NNNNNN. Assigned once on INSERT by '
  'trg_assign_work_item_number. Backfills MUST filter WHERE work_item_number IS NULL.';

-- Fail the migration if the applied numbers do not match what was recorded.
DO $$
DECLARE
  v_mismatch bigint;
BEGIN
  SELECT count(*) INTO v_mismatch
  FROM public.tasks t
  JOIN public.tasks_work_item_number_backup b ON b.task_id = t.id
  WHERE t.work_item_number IS DISTINCT FROM b.new_work_item_number;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'Renumber mismatch on % task(s); rolling back.', v_mismatch;
  END IF;
END;
$$;

COMMIT;
