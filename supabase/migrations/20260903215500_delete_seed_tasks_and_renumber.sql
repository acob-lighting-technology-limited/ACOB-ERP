-- Delete the April 2026 seed/demo task batch (TSK-000001..TSK-000013) and
-- renumber the remaining tasks to a contiguous series starting at TSK-000001.
--
-- Those 13 rows were created 2026-04-01..2026-04-17; real usage of the module
-- begins 2026-07-10. Five are explicitly titled "SEED:"; the other eight sit in
-- the same seeded cluster and share the same bulk-touch timestamp.
--
-- task_assignments, task_updates and task_user_completion cascade from tasks,
-- so their rows for these tasks are removed too. Snapshots of everything
-- deleted are kept in deleted_tasks_archive so this is recoverable.
--
-- Note: TSK-000013 mirrors help desk ticket HD-000037 (source_type='help_desk').
-- The ticket itself is NOT deleted; the app will recreate a mirror task with a
-- new number on the next sync.

BEGIN;

CREATE TABLE IF NOT EXISTS public.deleted_tasks_archive (
  id                bigserial PRIMARY KEY,
  deleted_at        timestamptz NOT NULL DEFAULT now(),
  reason            text NOT NULL,
  work_item_number  text,
  task_id           uuid,
  task_row          jsonb NOT NULL,
  child_rows        jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.deleted_tasks_archive IS
  'Full row snapshots of deleted tasks and their cascaded child rows. '
  'Written before deletion so a removal can be reconstructed.';

ALTER TABLE public.deleted_tasks_archive ENABLE ROW LEVEL SECURITY;
-- No policies: operator-only. service_role bypasses RLS.

-- Snapshot the tasks and everything that cascades from them.
INSERT INTO public.deleted_tasks_archive
  (reason, work_item_number, task_id, task_row, child_rows)
SELECT
  'April 2026 seed/demo batch removed 2026-09-03',
  t.work_item_number,
  t.id,
  to_jsonb(t),
  jsonb_build_object(
    'task_assignments', COALESCE(
      (SELECT jsonb_agg(to_jsonb(a)) FROM public.task_assignments a WHERE a.task_id = t.id),
      '[]'::jsonb),
    'task_updates', COALESCE(
      (SELECT jsonb_agg(to_jsonb(u)) FROM public.task_updates u WHERE u.task_id = t.id),
      '[]'::jsonb),
    'task_user_completion', COALESCE(
      (SELECT jsonb_agg(to_jsonb(c)) FROM public.task_user_completion c WHERE c.task_id = t.id),
      '[]'::jsonb)
  )
FROM public.tasks t
WHERE t.work_item_number <= 'TSK-000013';

-- Refuse to continue if the snapshot did not capture exactly the 13 rows.
DO $$
DECLARE
  v_archived bigint;
  v_targets  bigint;
BEGIN
  SELECT count(*) INTO v_archived
  FROM public.deleted_tasks_archive
  WHERE reason = 'April 2026 seed/demo batch removed 2026-09-03';

  SELECT count(*) INTO v_targets
  FROM public.tasks
  WHERE work_item_number <= 'TSK-000013';

  IF v_archived <> v_targets OR v_targets <> 13 THEN
    RAISE EXCEPTION
      'Expected 13 tasks to archive and delete; found % target(s), % archived. Rolling back.',
      v_targets, v_archived;
  END IF;
END;
$$;

-- Delete. The audit trigger stays enabled so the removal is recorded.
DELETE FROM public.tasks WHERE work_item_number <= 'TSK-000013';

-- Renumber the survivors. Triggers off so this does not stamp every row as
-- edited today or flood the audit log.
ALTER TABLE public.tasks DISABLE TRIGGER update_tasks_updated_at;
ALTER TABLE public.tasks DISABLE TRIGGER audit_tasks_changes;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM public.tasks
)
UPDATE public.tasks t
SET work_item_number = 'TMP-' || ordered.rn::text
FROM ordered
WHERE t.id = ordered.id;

UPDATE public.tasks
SET work_item_number = 'TSK-' || LPAD(
  regexp_replace(work_item_number, '^TMP-', '')::text, 6, '0'
)
WHERE work_item_number LIKE 'TMP-%';

-- Keep the original mapping table truthful: it maps the pre-2026-09-03 numbers
-- to whatever a task is called now. Rows for deleted tasks cascaded away.
UPDATE public.tasks_work_item_number_backup b
SET new_work_item_number = t.work_item_number
FROM public.tasks t
WHERE t.id = b.task_id
  AND b.new_work_item_number IS DISTINCT FROM t.work_item_number;

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

-- Final check: contiguous 1..N, no gaps, no duplicates, sequence aligned.
DO $$
DECLARE
  v_count bigint;
  v_max   bigint;
  v_bad   bigint;
BEGIN
  SELECT count(*), COALESCE(MAX((regexp_replace(work_item_number,'^TSK-',''))::bigint), 0)
  INTO v_count, v_max
  FROM public.tasks;

  SELECT count(*) INTO v_bad
  FROM public.tasks
  WHERE work_item_number !~ '^TSK-[0-9]{6}$';

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Found % task(s) with a malformed number. Rolling back.', v_bad;
  END IF;

  IF v_count <> v_max THEN
    RAISE EXCEPTION
      'Numbering is not contiguous: % tasks but highest number is %. Rolling back.',
      v_count, v_max;
  END IF;
END;
$$;

COMMIT;
