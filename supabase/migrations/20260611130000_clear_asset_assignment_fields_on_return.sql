-- Follow-up to 20260611120000. Two further gaps surfaced:
--
--   (A) atomic_assign_asset() stamps assets.department + assets.office_location from the
--       assignment, but nothing clears them on return. A released asset therefore keeps a
--       stale department/office and looks like it is still "assigned to a department".
--       (assets.department is purely an assignment artifact — the asset form only collects
--       an *assignment* department, there is no independent "home department" concept.)
--
--   (B) Assets assigned to staff who were exited via a path that pre-dated the exit-blocker
--       guard were never released: the assignment row is still is_current = true and the
--       asset status is still 'assigned', even though the holder has left.
--
-- This migration patches the return trigger to also clear department/office_location,
-- releases any asset still held by an exited employee, and backfills stale fields on
-- already-unassigned assets.

-- (A) Recreate the return trigger: on a genuine return, also null out department/office_location.
CREATE OR REPLACE FUNCTION public.handle_asset_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_asset_data jsonb; v_returner_name text; v_authorizer_name text;
  v_is_transfer boolean; v_notification_id uuid;
  v_service_key TEXT := current_setting('app.service_role_key', true);
  v_webhook_secret TEXT := current_setting('app.webhook_secret', true);
BEGIN
  IF OLD.is_current = true AND NEW.is_current = false THEN
    SELECT jsonb_build_object('unique_code', unique_code, 'asset_type', asset_type, 'asset_model', asset_model, 'serial_number', serial_number) INTO v_asset_data FROM public.assets WHERE id = NEW.asset_id;
    SELECT full_name INTO v_returner_name FROM public.profiles WHERE id = NEW.assigned_to;
    SELECT full_name INTO v_authorizer_name FROM public.profiles WHERE id = COALESCE(NEW.assigned_by, (SELECT auth.uid()));
    v_is_transfer := (NEW.handover_notes LIKE '%Reassigned%');
    INSERT INTO public.notifications (user_id, type, title, message, category, data)
    VALUES (NEW.assigned_to, CASE WHEN v_is_transfer THEN 'asset_transfer_outgoing' ELSE 'asset_returned' END, CASE WHEN v_is_transfer THEN 'Asset Transfer Initiated' ELSE 'Asset Officially Returned' END, CASE WHEN v_is_transfer THEN 'Asset ' || (v_asset_data->>'unique_code') || ' has been transferred from your custody.' ELSE 'You have successfully returned asset ' || (v_asset_data->>'unique_code') || '.' END, 'assets', v_asset_data || jsonb_build_object('returned_by', COALESCE(v_returner_name, 'User'), 'authorized_by', COALESCE(v_authorizer_name, 'System Admin'), 'return_date', COALESCE(NEW.handed_over_at, now()))) RETURNING id INTO v_notification_id;
    PERFORM net.http_post(url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-email-notification', headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key, 'apikey', v_service_key, 'x-webhook-secret', v_webhook_secret), body := jsonb_build_object('record', jsonb_build_object('id', v_notification_id, 'user_id', NEW.assigned_to, 'type', CASE WHEN v_is_transfer THEN 'asset_transfer_outgoing' ELSE 'asset_returned' END, 'title', CASE WHEN v_is_transfer THEN 'Asset Transfer Initiated' ELSE 'Asset Officially Returned' END, 'message', 'Asset update', 'data', v_asset_data || jsonb_build_object('authorized_by', COALESCE(v_authorizer_name, 'System Admin')))));

    -- Reset the parent asset on a genuine return. Skipped for transfers (the reassign RPC
    -- re-stamps these), and guarded so we never touch maintenance/retired assets or assets
    -- that still have a current assignment row.
    IF NOT v_is_transfer THEN
      UPDATE public.assets a
      SET status = 'available', department = NULL, office_location = NULL, updated_at = now()
      WHERE a.id = NEW.asset_id
        AND a.status = 'assigned'
        AND NOT EXISTS (
          SELECT 1 FROM public.asset_assignments aa
          WHERE aa.asset_id = NEW.asset_id AND aa.is_current = true
        );
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- (B) Release assets still held by exited employees. Disable the return trigger for this
-- one-time correction so we do not fire "asset returned" notifications/emails at people who
-- have already left. The audit trigger stays enabled.
ALTER TABLE public.asset_assignments DISABLE TRIGGER on_asset_assignment_return;

UPDATE public.asset_assignments aa
SET is_current = false, handed_over_at = now()
FROM public.profiles p
WHERE aa.assigned_to = p.id
  AND aa.is_current = true
  AND p.employment_status = 'exited';

ALTER TABLE public.asset_assignments ENABLE TRIGGER on_asset_assignment_return;

-- Backfill: any asset with no current assignment should be available with no stale
-- department/office. Restricted to assigned/available so maintenance/retired are untouched.
UPDATE public.assets a
SET status = 'available', department = NULL, office_location = NULL, updated_at = now()
WHERE a.status IN ('assigned', 'available')
  AND NOT EXISTS (
    SELECT 1 FROM public.asset_assignments aa
    WHERE aa.asset_id = a.id AND aa.is_current = true
  )
  AND (a.status = 'assigned' OR a.department IS NOT NULL OR a.office_location IS NOT NULL);
