-- Fix 1: process_notification_queue — read the service key from database settings
--         instead of embedding credentials in the migration.
-- Fix 2: enqueue_asset_notification_bundle — remove the 1-minute grace period so
--         notifications are queued for immediate delivery.

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

-- Fix 2: remove the grace period — notifications are enqueued for now() not now()+interval
create or replace function public.enqueue_asset_notification_bundle(
  p_target_user_id uuid,
  p_notification_type text,
  p_notification_title text,
  p_notification_message text,
  p_asset_id uuid,
  p_actor_name text default null,
  p_event_at timestamptz default now(),
  p_extra_data jsonb default '{}'::jsonb,
  p_fingerprint_suffix text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
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
begin
  if p_target_user_id is null then
    return;
  end if;

  select
    unique_code,
    jsonb_build_object(
      'unique_code', unique_code,
      'asset_type', asset_type,
      'asset_model', asset_model,
      'serial_number', serial_number,
      'department', department
    )
  into v_unique_code, v_asset_data
  from public.assets
  where id = p_asset_id;

  select
    coalesce(p.full_name, concat_ws(' ', p.first_name, p.last_name), p.company_email, 'Staff Member'),
    p.department,
    p.company_email
  into v_target_name, v_target_department, v_target_email
  from public.profiles p
  where p.id = p_target_user_id;

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

  if not exists (
    select 1
    from public.notification_queue nq
    where nq.user_id = p_target_user_id
      and nq.fingerprint = v_fingerprint
      and nq.status in ('pending', 'processing', 'sent')
  ) then
    insert into public.notifications (user_id, type, title, message, category, data)
    values (p_target_user_id, p_notification_type, p_notification_title, p_notification_message, 'assets', v_notification_data);

    insert into public.notification_queue (
      user_id, type, title, message, data, status, fingerprint, scheduled_for, process_after
    ) values (
      p_target_user_id, p_notification_type, p_notification_title, p_notification_message, v_notification_data,
      'pending', v_fingerprint, v_send_after, v_send_after
    );
  end if;

  for v_escalation in
    select recipient_id, recipient_role
    from public.resolve_asset_notification_escalation_recipient(p_target_user_id)
  loop
    if v_escalation.recipient_id is null or v_escalation.recipient_id = p_target_user_id then
      continue;
    end if;

    v_oversight_data := v_notification_data || jsonb_build_object(
      'mail_audience', 'oversight',
      'oversight_target_role', coalesce(v_escalation.recipient_role, 'Oversight Recipient')
    );

    v_fingerprint := p_notification_type || '_oversight_' || v_escalation.recipient_id::text || '_' || coalesce(v_unique_code, p_asset_id::text) || '_'
      || coalesce(p_fingerprint_suffix, to_char(date_trunc('second', p_event_at), 'YYYYMMDDHH24MISS'));

    if not exists (
      select 1
      from public.notification_queue nq
      where nq.user_id = v_escalation.recipient_id
        and nq.fingerprint = v_fingerprint
        and nq.status in ('pending', 'processing', 'sent')
    ) then
      insert into public.notifications (user_id, type, title, message, category, data)
      values (
        v_escalation.recipient_id,
        p_notification_type,
        case
          when p_notification_type = 'asset_assigned' then 'Asset Assignment Notice'
          when p_notification_type in ('asset_transfer_incoming', 'asset_transfer_outgoing') then 'Asset Transfer Notice'
          when p_notification_type = 'asset_returned' then 'Asset Return Notice'
          when p_notification_type = 'asset_status_alert' then 'Asset Status Alert Notice'
          when p_notification_type = 'asset_status_fixed' then 'Asset Status Restored Notice'
          else p_notification_title
        end,
        p_notification_message,
        'assets',
        v_oversight_data
      );

      insert into public.notification_queue (
        user_id, type, title, message, data, status, fingerprint, scheduled_for, process_after
      ) values (
        v_escalation.recipient_id,
        p_notification_type,
        case
          when p_notification_type = 'asset_assigned' then 'Asset Assignment Notice'
          when p_notification_type in ('asset_transfer_incoming', 'asset_transfer_outgoing') then 'Asset Transfer Notice'
          when p_notification_type = 'asset_returned' then 'Asset Return Notice'
          when p_notification_type = 'asset_status_alert' then 'Asset Status Alert Notice'
          when p_notification_type = 'asset_status_fixed' then 'Asset Status Restored Notice'
          else p_notification_title
        end,
        p_notification_message,
        v_oversight_data,
        'pending',
        v_fingerprint,
        v_send_after,
        v_send_after
      );
    end if;
  end loop;
end;
$$;
