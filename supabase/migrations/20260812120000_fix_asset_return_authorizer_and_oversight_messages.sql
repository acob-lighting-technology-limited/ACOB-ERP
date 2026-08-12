-- Migration: Fix asset return/reassignment authorizer name and oversight notification messages.
--
-- 1. Updates release_asset() and reassign_asset() to stamp the active admin's profile ID
--    (COALESCE(p_assigned_by/p_released_by, auth.uid())) on the closing assignment row,
--    preventing fallback to "System Admin" on returns/transfers.
-- 2. Updates enqueue_asset_notification() so oversight notifications receive clear, distinct
--    management messages (e.g. "Asset XYZ previously assigned to John Doe has been officially returned")
--    instead of telling the oversight recipient (MD/Lead) "We confirm that YOU have returned...".

CREATE OR REPLACE FUNCTION public.release_asset(
  p_asset_id uuid,
  p_released_by uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.asset_assignments
  SET is_current = false,
      assigned_by = COALESCE(p_released_by, (SELECT auth.uid()), assigned_by),
      handover_notes = 'Released',
      handed_over_at = now()
  WHERE asset_id = p_asset_id
    AND is_current = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_asset(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reassign_asset(
  p_asset_id UUID,
  p_new_assignment_type TEXT,
  p_assigned_to UUID,
  p_department TEXT,
  p_office_location TEXT,
  p_assigned_by UUID,
  p_assigned_at TIMESTAMPTZ,
  p_assignment_notes TEXT,
  p_handover_notes TEXT,
  p_new_status TEXT DEFAULT 'assigned'
) RETURNS VOID 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Close current assignment and stamp the releasing/reassigning admin's ID
  UPDATE public.asset_assignments
  SET is_current = false,
      handed_over_at = NOW(),
      handover_notes = p_handover_notes,
      assigned_by = COALESCE(p_assigned_by, (SELECT auth.uid()), assigned_by)
  WHERE asset_id = p_asset_id AND is_current = true;

  -- 2. Create new assignment
  INSERT INTO public.asset_assignments (
    asset_id,
    assignment_type,
    assigned_to,
    department,
    office_location,
    assigned_by,
    assigned_at,
    assignment_notes,
    is_current
  ) VALUES (
    p_asset_id,
    p_new_assignment_type,
    p_assigned_to,
    p_department,
    p_office_location,
    COALESCE(p_assigned_by, (SELECT auth.uid())),
    p_assigned_at,
    p_assignment_notes,
    true
  );

  -- 3. Update asset state
  UPDATE public.assets
  SET status = p_new_status,
      assignment_type = p_new_assignment_type,
      department = p_department,
      office_location = p_office_location
  WHERE id = p_asset_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_asset(uuid, text, uuid, text, text, uuid, timestamptz, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enqueue_asset_notification(
  p_target_user_id uuid,
  p_asset_id uuid,
  p_notification_type text,
  p_notification_title text,
  p_notification_message text,
  p_actor_name text DEFAULT NULL,
  p_event_at timestamptz DEFAULT now(),
  p_fingerprint_suffix text DEFAULT NULL,
  p_extra_data jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_send_after timestamptz := now();
  v_unique_code text;
  v_asset_data jsonb;
  v_target_name text;
  v_target_department text;
  v_target_email text;
  v_fingerprint text;
  v_escalation record;
  v_notification_data jsonb;
  v_oversight_data jsonb;
  v_oversight_message text;
BEGIN
  IF p_target_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    unique_code,
    jsonb_build_object(
      'unique_code', unique_code,
      'asset_type', asset_type,
      'asset_model', asset_model,
      'serial_number', serial_number,
      'department', department
    )
  INTO v_unique_code, v_asset_data
  FROM public.assets
  WHERE id = p_asset_id;

  SELECT
    coalesce(p.full_name, concat_ws(' ', p.first_name, p.last_name), p.company_email, 'Staff Member'),
    p.department,
    p.company_email
  INTO v_target_name, v_target_department, v_target_email
  FROM public.profiles p
  WHERE p.id = p_target_user_id;

  v_notification_data := coalesce(v_asset_data, '{}'::jsonb)
    || jsonb_build_object(
      'mail_audience', 'assignee',
      'assigned_employee_name', v_target_name,
      'assigned_employee_department', v_target_department,
      'assigned_employee_email', v_target_email,
      'assigned_by', coalesce(p_actor_name, 'System Admin'),
      'assigned_date', p_event_at
    )
    || coalesce(p_extra_data, '{}'::jsonb);

  v_fingerprint := p_notification_type || '_' || p_target_user_id::text || '_' || coalesce(v_unique_code, p_asset_id::text) || '_'
    || coalesce(p_fingerprint_suffix, to_char(date_trunc('second', p_event_at), 'YYYYMMDDHH24MISS'));

  IF NOT EXISTS (
    SELECT 1
    FROM public.notification_queue nq
    WHERE nq.user_id = p_target_user_id
      AND nq.fingerprint = v_fingerprint
      AND nq.status IN ('pending', 'processing', 'sent')
  ) THEN
    INSERT INTO public.notifications (user_id, type, title, message, category, data)
    VALUES (p_target_user_id, p_notification_type, p_notification_title, p_notification_message, 'assets', v_notification_data);

    INSERT INTO public.notification_queue (
      user_id, type, title, message, data, status, fingerprint, scheduled_for, process_after
    ) VALUES (
      p_target_user_id, p_notification_type, p_notification_title, p_notification_message, v_notification_data,
      'pending', v_fingerprint, v_send_after, v_send_after
    );
  END IF;

  FOR v_escalation IN
    SELECT recipient_id, recipient_role
    FROM public.resolve_asset_notification_escalation_recipient(p_target_user_id)
  LOOP
    IF v_escalation.recipient_id IS NULL OR v_escalation.recipient_id = p_target_user_id THEN
      CONTINUE;
    END IF;

    v_oversight_data := v_notification_data || jsonb_build_object(
      'mail_audience', 'oversight',
      'oversight_target_role', coalesce(v_escalation.recipient_role, 'Oversight Recipient')
    );

    v_oversight_message := CASE
      WHEN p_notification_type = 'asset_returned' THEN
        'Asset (' || coalesce(v_unique_code, p_asset_id::text) || ') previously assigned to ' || coalesce(v_target_name, 'a staff member') || ' has been officially returned.'
      WHEN p_notification_type = 'asset_assigned' THEN
        'Asset (' || coalesce(v_unique_code, p_asset_id::text) || ') has been assigned to ' || coalesce(v_target_name, 'a staff member') || '.'
      WHEN p_notification_type IN ('asset_transfer_incoming', 'asset_transfer_outgoing') THEN
        'Asset (' || coalesce(v_unique_code, p_asset_id::text) || ') transfer initiated for ' || coalesce(v_target_name, 'a staff member') || '.'
      ELSE p_notification_message
    END;

    v_fingerprint := p_notification_type || '_oversight_' || v_escalation.recipient_id::text || '_' || coalesce(v_unique_code, p_asset_id::text) || '_'
      || coalesce(p_fingerprint_suffix, to_char(date_trunc('second', p_event_at), 'YYYYMMDDHH24MISS'));

    IF NOT EXISTS (
      SELECT 1
      FROM public.notification_queue nq
      WHERE nq.user_id = v_escalation.recipient_id
        AND nq.fingerprint = v_fingerprint
        AND nq.status IN ('pending', 'processing', 'sent')
    ) THEN
      INSERT INTO public.notifications (user_id, type, title, message, category, data)
      VALUES (
        v_escalation.recipient_id,
        p_notification_type,
        CASE
          WHEN p_notification_type = 'asset_assigned' THEN 'Asset Assignment Notice'
          WHEN p_notification_type IN ('asset_transfer_incoming', 'asset_transfer_outgoing') THEN 'Asset Transfer Notice'
          WHEN p_notification_type = 'asset_returned' THEN 'Asset Return Notice'
          WHEN p_notification_type = 'asset_status_alert' THEN 'Asset Status Alert Notice'
          WHEN p_notification_type = 'asset_status_fixed' THEN 'Asset Status Restored Notice'
          ELSE p_notification_title
        END,
        v_oversight_message,
        'assets',
        v_oversight_data
      );

      INSERT INTO public.notification_queue (
        user_id, type, title, message, data, status, fingerprint, scheduled_for, process_after
      ) VALUES (
        v_escalation.recipient_id,
        p_notification_type,
        CASE
          WHEN p_notification_type = 'asset_assigned' THEN 'Asset Assignment Notice'
          WHEN p_notification_type IN ('asset_transfer_incoming', 'asset_transfer_outgoing') THEN 'Asset Transfer Notice'
          WHEN p_notification_type = 'asset_returned' THEN 'Asset Return Notice'
          WHEN p_notification_type = 'asset_status_alert' THEN 'Asset Status Alert Notice'
          WHEN p_notification_type = 'asset_status_fixed' THEN 'Asset Status Restored Notice'
          ELSE p_notification_title
        END,
        v_oversight_message,
        v_oversight_data,
        'pending',
        v_fingerprint,
        v_send_after,
        v_send_after
      );
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_asset_notification(uuid, uuid, text, text, text, text, timestamptz, text, jsonb) TO authenticated, service_role;
