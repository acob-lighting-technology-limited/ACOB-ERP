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
