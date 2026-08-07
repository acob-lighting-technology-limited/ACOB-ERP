-- Reconcile production schema drift (audited 2026-08-06 against itqegqxeqkeogwrvlzlj).
--
-- WHY THIS EXISTS: `supabase_migrations` on prod records the migrations below as
-- applied, but none of the objects they create actually exist there — the history
-- table was stamped without the SQL ever executing. So `list_migrations` cannot be
-- trusted, and re-running the originals is a no-op from the CLI's point of view.
-- This migration re-applies only the objects that are verifiably absent in prod and
-- that deployed code on `main` already calls.
--
-- Everything here is idempotent (IF NOT EXISTS / CREATE OR REPLACE), so it is safe
-- on any environment where the objects DO already exist.
--
-- Verified before writing: every column and constraint these functions depend on
-- already exists in prod (incl. the leave_approvals UNIQUE
-- (leave_request_id, approver_id, approval_level) that the ON CONFLICT targets).
--
-- Re-applies, in order:
--   20260515110000_attendance_exemption_windows        (profiles exemption columns)
--   20260710120000_oos_periods_and_exempt_kind         (attendance_oos_periods)
--   20260513101000_atomic_leave_approval_transitions   (leave approve/reject)
--   20260513100000_atomic_asset_assignment             (atomic_assign_asset)
--   20260513102000_atomic_correspondence_dispatch      (dispatch)
-- Plus one genuine bug fix: ambiguous `reset_at` in rate_limit_increment.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Attendance exemption columns
--    Broken today: POST /api/admin/hr/attendance/exemptions returns
--    500 "Failed to update exemption"; the attendance reports route logs
--    "column profiles.attendance_exempt_until does not exist" on every call
--    before falling back.
-- ────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS attendance_exempt_until date,
  ADD COLUMN IF NOT EXISTS attendance_exempt_reason text,
  ADD COLUMN IF NOT EXISTS attendance_exempt_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_exempt_set_by uuid REFERENCES public.profiles(id);

-- ────────────────────────────────────────────────────────────────────────
-- 2. Out-of-Station directives
--    Broken today: POST /api/admin/hr/attendance/oos-periods returns
--    500 "Failed to create indefinite OOS", and the midnight cron
--    (/api/cron/attendance/mark-incomplete) silently extends 0 open OOS days
--    every night because the table it reads does not exist.
-- ────────────────────────────────────────────────────────────────────────
alter table public.attendance_exempt_periods
  drop constraint if exists attendance_exempt_periods_kind_check;

alter table public.attendance_exempt_periods
  add constraint attendance_exempt_periods_kind_check
  check (kind in ('weekly', 'monthly', 'period', 'infinite'));

create table if not exists public.attendance_oos_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date null,                       -- NULL = indefinite / open-ended
  kind text not null default 'period'
    check (kind in ('weekly', 'monthly', 'period', 'infinite')),
  reason text null,
  status text not null default 'active'
    check (status in ('active', 'stopped')),
  created_by uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_oos_periods_user_date
  on public.attendance_oos_periods (user_id, start_date, end_date);

-- Open (indefinite, still-active) directives the cron must extend forward.
create index if not exists idx_attendance_oos_periods_open
  on public.attendance_oos_periods (status)
  where end_date is null and status = 'active';

alter table public.attendance_oos_periods enable row level security;
revoke all on public.attendance_oos_periods from anon;

drop policy if exists "attendance_oos_periods_select" on public.attendance_oos_periods;
create policy "attendance_oos_periods_select"
on public.attendance_oos_periods for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

drop policy if exists "attendance_oos_periods_manage" on public.attendance_oos_periods;
create policy "attendance_oos_periods_manage"
on public.attendance_oos_periods for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
  )
);

-- ────────────────────────────────────────────────────────────────────────
-- 3. Leave approval workflow
--    Broken today: every approve/reject in POST /api/hr/leave/approve returns
--    500 "Failed to approve/reject leave request". leave_approvals has never
--    recorded a single row in prod.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_leave_reject(
  p_leave_request_id uuid,
  p_actor_profile_id uuid,
  p_current_stage_order integer,
  p_stage_code text,
  p_comments text,
  p_reliever_revision integer,
  p_reliever_decision_at timestamptz,
  p_supervisor_decision_at timestamptz,
  p_hr_decision_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE leave_requests
  SET status = 'rejected',
      approval_stage = 'rejected',
      current_stage_code = 'rejected',
      rejected_reason = p_comments,
      workflow_rejection_stage = CASE
        WHEN p_stage_code = 'pending_reliever' THEN 'reliever'
        WHEN p_stage_code = 'pending_department_lead' THEN 'supervisor'
        ELSE 'hr'
      END,
      reliever_decision_at = p_reliever_decision_at,
      supervisor_decision_at = p_supervisor_decision_at,
      hr_decision_at = p_hr_decision_at
  WHERE id = p_leave_request_id;

  INSERT INTO leave_approvals (
    leave_request_id, approver_id, approval_level, status, comments,
    approved_at, stage_code, stage_order, reliever_revision, superseded
  ) VALUES (
    p_leave_request_id, p_actor_profile_id, p_current_stage_order, 'rejected', p_comments,
    NOW(), p_stage_code, p_current_stage_order, COALESCE(p_reliever_revision, 1), false
  )
  ON CONFLICT (leave_request_id, approver_id, approval_level)
  DO UPDATE SET
    status = EXCLUDED.status,
    comments = EXCLUDED.comments,
    approved_at = EXCLUDED.approved_at,
    stage_code = EXCLUDED.stage_code,
    stage_order = EXCLUDED.stage_order,
    reliever_revision = EXCLUDED.reliever_revision,
    superseded = EXCLUDED.superseded;
END;
$$;

CREATE OR REPLACE FUNCTION public.atomic_leave_approve_final(
  p_leave_request_id uuid,
  p_actor_profile_id uuid,
  p_current_stage_order integer,
  p_stage_code text,
  p_comments text,
  p_reliever_revision integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO leave_approvals (
    leave_request_id, approver_id, approval_level, status, comments,
    approved_at, stage_code, stage_order, reliever_revision, superseded
  ) VALUES (
    p_leave_request_id, p_actor_profile_id, p_current_stage_order, 'approved', p_comments,
    NOW(), p_stage_code, p_current_stage_order, COALESCE(p_reliever_revision, 1), false
  )
  ON CONFLICT (leave_request_id, approver_id, approval_level)
  DO UPDATE SET
    status = EXCLUDED.status,
    comments = EXCLUDED.comments,
    approved_at = EXCLUDED.approved_at,
    stage_code = EXCLUDED.stage_code,
    stage_order = EXCLUDED.stage_order,
    reliever_revision = EXCLUDED.reliever_revision,
    superseded = EXCLUDED.superseded;

  UPDATE leave_requests
  SET status = 'approved',
      approval_stage = 'completed',
      current_stage_code = 'completed',
      approved_by = p_actor_profile_id,
      approved_at = NOW(),
      hr_decision_at = NOW(),
      hr_comment = p_comments,
      lead_reconfirm_required = false
  WHERE id = p_leave_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.atomic_leave_approve_transition(
  p_leave_request_id uuid,
  p_actor_profile_id uuid,
  p_current_stage_order integer,
  p_stage_code text,
  p_next_stage_code text,
  p_next_stage_order integer,
  p_next_approver_user_id uuid,
  p_comments text,
  p_reliever_revision integer,
  p_reliever_decision_at timestamptz,
  p_supervisor_decision_at timestamptz,
  p_hr_decision_at timestamptz,
  p_lead_reconfirm_required boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO leave_approvals (
    leave_request_id, approver_id, approval_level, status, comments,
    approved_at, stage_code, stage_order, reliever_revision, superseded
  ) VALUES (
    p_leave_request_id, p_actor_profile_id, p_current_stage_order, 'approved', p_comments,
    NOW(), p_stage_code, p_current_stage_order, COALESCE(p_reliever_revision, 1), false
  )
  ON CONFLICT (leave_request_id, approver_id, approval_level)
  DO UPDATE SET
    status = EXCLUDED.status,
    comments = EXCLUDED.comments,
    approved_at = EXCLUDED.approved_at,
    stage_code = EXCLUDED.stage_code,
    stage_order = EXCLUDED.stage_order,
    reliever_revision = EXCLUDED.reliever_revision,
    superseded = EXCLUDED.superseded;

  UPDATE leave_requests
  SET approval_stage = p_next_stage_code,
      current_stage_code = p_next_stage_code,
      current_stage_order = p_next_stage_order,
      current_approver_user_id = p_next_approver_user_id,
      lead_reconfirm_required = p_lead_reconfirm_required,
      reliever_decision_at = p_reliever_decision_at,
      reliever_comment = CASE WHEN p_stage_code = 'pending_reliever' THEN p_comments ELSE reliever_comment END,
      supervisor_decision_at = p_supervisor_decision_at,
      supervisor_comment = CASE WHEN p_stage_code = 'pending_department_lead' THEN p_comments ELSE supervisor_comment END,
      hr_decision_at = p_hr_decision_at,
      hr_comment = CASE WHEN p_stage_code IN ('pending_admin_hr_lead', 'pending_hcs') THEN p_comments ELSE hr_comment END
  WHERE id = p_leave_request_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Asset assignment
--    Broken today: assigning an unassigned asset from the asset Edit dialog
--    (PUT /api/admin/assets) throws. The separate reassign path uses
--    reassign_asset, which does exist in prod — hence assignments that
--    already work.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_assign_asset(
  p_asset_id uuid,
  p_assigned_by uuid,
  p_assigned_at timestamptz,
  p_assignment_type text,
  p_assigned_to uuid,
  p_department text,
  p_office_location text,
  p_notes text,
  p_handover_notes text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment_id uuid;
BEGIN
  UPDATE asset_assignments
  SET is_current = false,
      handover_notes = p_handover_notes,
      handed_over_at = NOW()
  WHERE asset_id = p_asset_id AND is_current = true;

  INSERT INTO asset_assignments (
    asset_id, assigned_by, assigned_at, is_current,
    assignment_notes, assignment_type,
    assigned_to, department, office_location
  ) VALUES (
    p_asset_id, p_assigned_by, p_assigned_at, true,
    p_notes, p_assignment_type,
    p_assigned_to, p_department, p_office_location
  )
  RETURNING id INTO v_assignment_id;

  UPDATE assets
  SET status = 'assigned',
      assignment_type = p_assignment_type,
      department = p_department,
      office_location = p_office_location,
      updated_at = NOW()
  WHERE id = p_asset_id;

  RETURN v_assignment_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 5. Correspondence dispatch
--    Broken today: POST /api/correspondence/records/[id]/dispatch throws.
--    Prod has 158 records stuck at 'approved' and 0 ever dispatched.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.atomic_dispatch_correspondence(
  p_record_id uuid,
  p_actor_id uuid,
  p_final_status text,
  p_dispatch_method text,
  p_proof_of_delivery_path text,
  p_recipient_name text,
  p_old_status text
)
RETURNS correspondence_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record correspondence_records;
BEGIN
  UPDATE correspondence_records
  SET status = p_final_status,
      dispatch_method = p_dispatch_method,
      proof_of_delivery_path = p_proof_of_delivery_path,
      recipient_name = p_recipient_name,
      sent_at = NOW(),
      is_locked = true,
      updated_at = NOW()
  WHERE id = p_record_id
  RETURNING * INTO v_record;

  INSERT INTO correspondence_events (
    correspondence_id,
    actor_id,
    event_type,
    old_status,
    new_status,
    details
  ) VALUES (
    p_record_id,
    p_actor_id,
    'dispatched',
    p_old_status,
    p_final_status,
    jsonb_build_object(
      'dispatch_method', p_dispatch_method,
      'proof_of_delivery_path', p_proof_of_delivery_path
    )
  );

  RETURN v_record;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 6. Bug fix: ambiguous `reset_at` in rate_limit_increment.
--    The opportunistic cleanup DELETE referenced the bare column name, which
--    also matches the function's RETURNS TABLE output column, so ~1% of calls
--    (the random() branch) failed with 42702 and rate limiting silently fell
--    back to per-lambda in-memory counting. Aliasing the table disambiguates.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rate_limit_increment(p_key text, p_window_seconds integer, p_limit integer)
RETURNS TABLE (allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := now();
  v_reset_at timestamptz;
  v_count integer;
BEGIN
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_counters c WHERE c.reset_at < v_now - interval '1 day';
  END IF;

  INSERT INTO public.rate_limit_counters (key, count, reset_at)
  VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                   WHEN rate_limit_counters.reset_at < v_now THEN 1
                   ELSE rate_limit_counters.count + 1
                 END,
        reset_at = CASE
                     WHEN rate_limit_counters.reset_at < v_now THEN v_now + make_interval(secs => p_window_seconds)
                     ELSE rate_limit_counters.reset_at
                   END
  RETURNING rate_limit_counters.count, rate_limit_counters.reset_at INTO v_count, v_reset_at;

  RETURN QUERY SELECT (v_count <= p_limit), GREATEST(0, p_limit - v_count), v_reset_at;
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_increment(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_increment(text, integer, integer) TO service_role;
