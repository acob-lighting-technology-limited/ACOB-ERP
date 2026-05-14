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
