-- Backfill attendance_events from existing history so past days tell their story.
-- Idempotent: guarded by NOT EXISTS, so re-running inserts nothing new.

-- 1) Appeal requests
INSERT INTO public.attendance_events
  (user_id, event_date, attendance_record_id, event_type, from_status, to_status, source, comment, actor_id, metadata, created_at)
SELECT a.user_id, a.appeal_date, a.attendance_record_id, 'appeal_requested',
       a.current_status, a.requested_status, 'appeal', a.appeal_reason, a.user_id,
       jsonb_build_object('appeal_id', a.id), a.created_at
FROM public.attendance_appeals a
WHERE NOT EXISTS (
  SELECT 1 FROM public.attendance_events e
  WHERE e.event_type = 'appeal_requested' AND e.metadata->>'appeal_id' = a.id::text
);

-- 2) Appeal decisions (approved / rejected)
INSERT INTO public.attendance_events
  (user_id, event_date, attendance_record_id, event_type, from_status, to_status, source, comment, actor_id, metadata, created_at)
SELECT a.user_id, a.appeal_date, a.attendance_record_id,
       CASE WHEN a.status = 'approved' THEN 'appeal_approved' ELSE 'appeal_rejected' END,
       a.current_status,
       CASE WHEN a.status = 'approved' THEN a.requested_status ELSE a.current_status END,
       'appeal', a.resolution_note, a.reviewed_by,
       jsonb_build_object('appeal_id', a.id, 'requested_status', a.requested_status),
       COALESCE(a.reviewed_at, a.updated_at)
FROM public.attendance_appeals a
WHERE a.status IN ('approved', 'rejected')
  AND NOT EXISTS (
    SELECT 1 FROM public.attendance_events e
    WHERE e.event_type IN ('appeal_approved', 'appeal_rejected')
      AND e.metadata->>'appeal_id' = a.id::text
  );

-- 3) Device punches + manual edits recovered from the existing audit trail, so the
--    timeline keeps showing past clock-ins/outs that pre-date the ledger. Both the
--    singular and legacy plural entity_type spellings are covered.
INSERT INTO public.attendance_events
  (user_id, event_date, attendance_record_id, event_type, to_status, source, comment, actor_id, metadata, created_at)
SELECT ar.user_id, ar.date, ar.id,
       CASE
         WHEN al.new_values->>'source' = 'hikvision' AND al.action = 'create' THEN 'device_punch_in'
         WHEN al.new_values->>'source' = 'hikvision' AND al.action = 'update' THEN 'device_punch_out'
         WHEN al.action = 'create' THEN 'manual_create'
         ELSE 'manual_update'
       END,
       al.new_values->>'status',
       COALESCE(al.new_values->>'source', 'manual'),
       al.new_values->>'manual_comment',
       al.user_id,
       jsonb_build_object('backfilled', true),
       al.created_at
FROM public.audit_logs al
JOIN public.attendance_records ar ON ar.id::text = al.entity_id
WHERE al.entity_type IN ('attendance_record', 'attendance_records')
  AND NOT EXISTS (
    SELECT 1 FROM public.attendance_events e
    WHERE e.attendance_record_id = ar.id
      AND e.created_at = al.created_at
      AND e.event_type IN ('device_punch_in', 'device_punch_out', 'manual_create', 'manual_update')
  );

-- 4) Manual grants (OOS / waiver) that have neither an event nor an audit row nor an
--    appeal story — e.g. bulk grants created before per-record provenance existed.
--    Actor is unknown for these historical rows — recorded honestly as a backfill.
INSERT INTO public.attendance_events
  (user_id, event_date, attendance_record_id, event_type, to_status, source, comment, actor_id, metadata, created_at)
SELECT ar.user_id, ar.date, ar.id, 'bulk_grant', ar.status, 'manual', ar.manual_comment, NULL,
       jsonb_build_object('backfilled', true), COALESCE(ar.updated_at, ar.created_at, now())
FROM public.attendance_records ar
WHERE ar.source = 'manual'
  AND NOT EXISTS (SELECT 1 FROM public.attendance_events e WHERE e.attendance_record_id = ar.id)
  AND NOT EXISTS (SELECT 1 FROM public.attendance_events e WHERE e.user_id = ar.user_id AND e.event_date = ar.date);
