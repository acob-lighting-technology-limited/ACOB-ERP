-- Assets unassigned via staff exit (or any other is_current -> false path) were left
-- with assets.status = 'assigned' even though no current assignment remained, because
-- handle_asset_return() only emitted notifications and never reset the asset status.
--
-- This migration:
--   1. Backfills every asset stuck as 'assigned' with no current assignment -> 'available'.
--   2. Patches handle_asset_return() to reset status to 'available' on a genuine return
--      (not a transfer/reassign), guarded so it never clobbers maintenance/retired assets
--      or assets that still have a current assignment.

-- 1. Backfill orphaned assets
UPDATE public.assets a
SET status = 'available', updated_at = now()
WHERE a.status = 'assigned'
  AND NOT EXISTS (
    SELECT 1 FROM public.asset_assignments aa
    WHERE aa.asset_id = a.id AND aa.is_current = true
  );

-- 2. Recreate the trigger function with the status reset added.
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

    -- Reset the parent asset to 'available' on a genuine return. Skipped for transfers
    -- (the reassign RPC sets status back to 'assigned'), and guarded so we never override
    -- maintenance/retired assets or assets that still have a current assignment row.
    IF NOT v_is_transfer THEN
      UPDATE public.assets a
      SET status = 'available', updated_at = now()
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
