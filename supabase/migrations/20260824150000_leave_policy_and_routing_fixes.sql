-- Leave policy + routing fixes:
--  1. Ordinary "employee" leave requests were missing the MD (final) approval
--     stage that every other requester_kind already has.
--  2. Sick leave entitlement -> 12 days.
--  3. Annual leave entitlement -> 15 days (non-lead) / 20 days (lead), via a
--     new lead_max_days override column on leave_types.
--  4. Casual leave and leave encashment are retired and should be hard
--     deleted (they were already deactivated), unless historical
--     leave_requests reference them, in which case they are left alone.

-- (1) MD final-approval stage for plain employees
INSERT INTO public.leave_approval_role_routes (requester_kind, stage_order, approver_role_code, is_active)
VALUES ('employee', 4, 'md', true)
ON CONFLICT (requester_kind, stage_order) DO UPDATE
SET approver_role_code = EXCLUDED.approver_role_code,
    is_active = true,
    updated_at = now();

-- (3) Lead-aware annual leave override column
ALTER TABLE public.leave_types ADD COLUMN IF NOT EXISTS lead_max_days integer;

-- (2) Sick leave -> 12 days
UPDATE public.leave_types
SET max_days = 12
WHERE name ILIKE '%sick%';

-- (3) Annual leave -> 15 (non-lead) / 20 (lead)
UPDATE public.leave_types
SET max_days = 15, lead_max_days = 20
WHERE name ILIKE '%annual%';

-- (4) Casual leave + leave encashment: hard delete if unused, else leave inactive
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, name FROM public.leave_types
    WHERE name ILIKE '%casual%' OR name ILIKE '%encashment%'
  LOOP
    IF EXISTS (SELECT 1 FROM public.leave_requests WHERE leave_type_id = r.id) THEN
      RAISE NOTICE 'Skipping delete of leave_type % (%) - has historical leave_requests', r.name, r.id;
      UPDATE public.leave_types SET is_active = false WHERE id = r.id;
    ELSE
      DELETE FROM public.leave_policies WHERE leave_type_id = r.id;
      DELETE FROM public.leave_types WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
