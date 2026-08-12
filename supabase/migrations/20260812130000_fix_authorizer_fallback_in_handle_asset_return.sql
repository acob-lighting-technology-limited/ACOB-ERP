-- Migration: Robust Authorizer Resolution in handle_asset_return Trigger
-- 
-- Fixes authorizer lookup so that if NEW.assigned_by is NULL (on older historical assignment rows),
-- it dynamically resolves the releasing/reassigning admin's profile name instead of falling back to "System Admin".

CREATE OR REPLACE FUNCTION public.handle_asset_return()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_asset_data jsonb;
  v_returner_name text;
  v_authorizer_name text;
  v_is_transfer boolean;
  v_notification_id uuid;
  v_service_key TEXT := current_setting('app.service_role_key', true);
  v_webhook_secret TEXT := current_setting('app.webhook_secret', true);
BEGIN
  IF OLD.is_current = true AND NEW.is_current = false THEN
    -- Asset details
    SELECT jsonb_build_object(
      'unique_code', unique_code,
      'asset_type', asset_type,
      'asset_model', asset_model,
      'serial_number', serial_number
    ) INTO v_asset_data
    FROM public.assets
    WHERE id = NEW.asset_id;

    -- Returner name
    SELECT full_name INTO v_returner_name
    FROM public.profiles
    WHERE id = NEW.assigned_to;

    -- Authorizer name resolution:
    -- 1. Try NEW.assigned_by (stamped by release_asset/reassign_asset)
    IF NEW.assigned_by IS NOT NULL THEN
      SELECT full_name INTO v_authorizer_name
      FROM public.profiles
      WHERE id = NEW.assigned_by;
    END IF;

    -- 2. Try auth.uid() if present
    IF v_authorizer_name IS NULL AND auth.uid() IS NOT NULL THEN
      SELECT full_name INTO v_authorizer_name
      FROM public.profiles
      WHERE id = auth.uid();
    END IF;

    -- 3. Fallback: try latest assigned_by on any assignment for this asset
    IF v_authorizer_name IS NULL THEN
      SELECT p.full_name INTO v_authorizer_name
      FROM public.asset_assignments aa
      JOIN public.profiles p ON p.id = aa.assigned_by
      WHERE aa.asset_id = NEW.asset_id
        AND aa.assigned_by IS NOT NULL
      ORDER BY aa.created_at DESC
      LIMIT 1;
    END IF;

    -- Final fallback if completely unresolvable
    IF v_authorizer_name IS NULL THEN
      v_authorizer_name := 'System Admin';
    END IF;

    v_is_transfer := (NEW.handover_notes LIKE '%Reassigned%');

    INSERT INTO public.notifications (user_id, type, title, message, category, data)
    VALUES (
      NEW.assigned_to,
      CASE WHEN v_is_transfer THEN 'asset_transfer_outgoing' ELSE 'asset_returned' END,
      CASE WHEN v_is_transfer THEN 'Asset Transfer Initiated' ELSE 'Asset Officially Returned' END,
      CASE WHEN v_is_transfer 
           THEN 'Asset ' || (v_asset_data->>'unique_code') || ' has been transferred from your custody.' 
           ELSE 'You have successfully returned asset ' || (v_asset_data->>'unique_code') || '.' 
      END,
      'assets',
      v_asset_data || jsonb_build_object(
        'returned_by', COALESCE(v_returner_name, 'User'),
        'authorized_by', v_authorizer_name,
        'return_date', COALESCE(NEW.handed_over_at, now())
      )
    ) RETURNING id INTO v_notification_id;

    PERFORM net.http_post(
      url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/send-email-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key,
        'apikey', v_service_key,
        'x-webhook-secret', v_webhook_secret
      ),
      body := jsonb_build_object(
        'record', jsonb_build_object(
          'id', v_notification_id,
          'user_id', NEW.assigned_to,
          'type', CASE WHEN v_is_transfer THEN 'asset_transfer_outgoing' ELSE 'asset_returned' END,
          'title', CASE WHEN v_is_transfer THEN 'Asset Transfer Initiated' ELSE 'Asset Officially Returned' END,
          'message', 'Asset update',
          'data', v_asset_data || jsonb_build_object(
            'authorized_by', v_authorizer_name,
            'returned_by', COALESCE(v_returner_name, 'User'),
            'return_date', COALESCE(NEW.handed_over_at, now())
          )
        )
      )
    );

    -- Reset parent asset on genuine return
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
