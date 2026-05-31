CREATE OR REPLACE FUNCTION public.process_notification_queue()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  v_notification_id UUID;
  v_service_key TEXT := NULLIF(current_setting('app.service_role_key', true), '');
  v_webhook_secret TEXT := 'acob_notification_trigger_secret_2026';
  v_safe_type TEXT;
BEGIN
  FOR r IN
    SELECT * FROM public.notification_queue
    WHERE status != 'sent' AND status != 'cancelled'
      AND (process_after IS NULL OR process_after <= now())
    LIMIT 20
  LOOP
    IF v_service_key IS NULL THEN
      RAISE NOTICE 'app.service_role_key is not configured; skipping notification queue processing';
      RETURN;
    END IF;

    v_safe_type := CASE
      WHEN r.type = 'asset_assignment' THEN 'asset_assigned'
      WHEN r.type = 'asset_transfer_incoming' THEN 'asset_transfer_incoming'
      WHEN r.type = 'asset_returned' THEN 'asset_returned'
      ELSE r.type
    END;
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, message, data, priority, created_at)
      VALUES (r.user_id, v_safe_type, r.title, r.message, r.data, 'normal', NOW())
      RETURNING id INTO v_notification_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Failed to insert UI notification: %', SQLERRM;
    END;
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
          'id', r.id,
          'user_id', r.user_id,
          'type', r.type,
          'title', r.title,
          'message', r.message,
          'data', r.data
        )
      )
    );
    UPDATE public.notification_queue SET status = 'sent', sent_at = NOW() WHERE id = r.id;
  END LOOP;
END;
$$;
