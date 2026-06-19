-- Adds a first-class "release / unassign" action. Previously the only way to clear an
-- asset from someone (e.g. to unblock an exit) was to reassign it to another active
-- employee. release_asset() lets an admin return an asset to the available pool directly.
--
-- It only marks the current assignment as not-current; the on_asset_assignment_return
-- trigger (handle_asset_return) then sets the asset back to 'available', clears the stale
-- department/office_location, and notifies the holder that the asset was returned.

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
      -- Surface the releasing admin as the "authorized by" in the return notification.
      assigned_by = COALESCE(p_released_by, assigned_by),
      handover_notes = 'Released',
      handed_over_at = now()
  WHERE asset_id = p_asset_id
    AND is_current = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_asset(uuid, uuid) TO authenticated;
