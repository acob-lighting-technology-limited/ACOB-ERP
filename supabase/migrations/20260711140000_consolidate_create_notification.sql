-- Consolidates the 4 create_notification() overloads down to one canonical
-- signature. Audit (2026-07-11) confirmed:
--   - Every app caller (lib/notifications.ts + ~15 API routes) sends the same
--     11 named params: p_user_id, p_type, p_category, p_title, p_message,
--     p_priority, p_link_url, p_actor_id, p_entity_type, p_entity_id,
--     p_rich_content — matching the signatures below called "A" and "D".
--   - Postgres/PostgREST silently resolves every call to "D"
--     (entity_id text, category/title/message optional), never "A"
--     (entity_id uuid, category/title/message required) — confirmed via a
--     direct SQL probe. "A" was fully dead code despite being the version
--     documented in AGENTS.md.
--   - "D"'s body never checks notification_preferences /
--     notification_delivery_policies / notification_user_delivery_preferences
--     — the user-facing notification opt-out settings (app/api/settings/
--     notifications/route.ts) have been silently non-functional for in-app
--     notification creation. "A"'s body respects them correctly.
--   - "D" also never populates the notifications table's actor_id/
--     entity_type/entity_id/rich_content/link_url columns — everything gets
--     packed into `data` jsonb instead, and link_url is written as
--     action_url. Nothing in the app reads `data` or `link_url`; the UI
--     (notification-bell.tsx, notifications page) reads `action_url` only.
--   - The action_url/action_label/related_entity_*/metadata overload (11
--     params, different names) is never called by name anywhere in the app
--     OR by any trigger — confirmed dead, safe to drop.
--   - The 7-param p_data overload (uuid,text,text,text,jsonb,text,text)
--     looked unused from app-code grep alone, but IS actively called by two
--     enabled triggers: notify_task_completed (on remote_tasks) and
--     notify_token_generated (on token_sales). This overload must be KEPT.
--
-- This migration keeps signature "A"'s param types (entity_id uuid — every
-- real caller passes a genuine row UUID) and preference-aware body, but also
-- writes action_url (for UI back-compat) and keeps `data` populated for any
-- future/legacy reader. Only the confirmed-dead action_url/action_label
-- overload and the old "D" (entity_id text) overload are dropped.
DROP FUNCTION IF EXISTS public.create_notification(uuid, text, text, text, text, text, text, text, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.create_notification(uuid, text, text, text, text, text, text, uuid, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_notification(
  p_user_id uuid,
  p_type text,
  p_category text,
  p_title text,
  p_message text,
  p_priority text DEFAULT 'normal'::text,
  p_link_url text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_entity_type text DEFAULT NULL::text,
  p_entity_id uuid DEFAULT NULL::uuid,
  p_rich_content jsonb DEFAULT NULL::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_notification_id uuid;
  v_preferences public.notification_preferences%rowtype;
  v_module_key text := 'system';
  v_system_in_app_enabled boolean := true;
  v_system_in_app_mandatory boolean := false;
  v_user_module_in_app_enabled boolean := true;
begin
  -- map category/entity into module key for in-app policy enforcement
  if p_category = 'assets' then
    v_module_key := 'assets';
  elsif p_entity_type = 'leave_request' then
    v_module_key := 'leave';
  elsif p_entity_type = 'help_desk_ticket' then
    v_module_key := 'help_desk';
  elsif p_entity_type = 'meeting' then
    v_module_key := 'meetings';
  elsif p_entity_type = 'weekly_report' then
    v_module_key := 'reports';
  elsif p_entity_type = 'communication_broadcast' then
    v_module_key := 'communications';
  elsif p_category = 'system' then
    v_module_key := 'system';
  end if;

  select *
  into v_preferences
  from public.notification_preferences
  where user_id = p_user_id;

  if not found then
    insert into public.notification_preferences (user_id)
    values (p_user_id)
    on conflict (user_id) do nothing;

    v_preferences.user_id := p_user_id;
    v_preferences.in_app_enabled := true;
  end if;

  select ndp.in_app_enabled, coalesce(ndp.in_app_mandatory, false)
  into v_system_in_app_enabled, v_system_in_app_mandatory
  from public.notification_delivery_policies ndp
  where ndp.notification_key = v_module_key;

  if v_system_in_app_enabled is null then
    v_system_in_app_enabled := true;
  end if;

  if v_system_in_app_mandatory then
    v_user_module_in_app_enabled := true;
  else
    select coalesce(nudp.in_app_enabled, true)
    into v_user_module_in_app_enabled
    from public.notification_user_delivery_preferences nudp
    where nudp.user_id = p_user_id
      and nudp.notification_key = v_module_key;

    if v_user_module_in_app_enabled is null then
      v_user_module_in_app_enabled := true;
    end if;
  end if;

  if v_system_in_app_enabled
     and (
      v_system_in_app_mandatory
      or (
        coalesce(v_preferences.in_app_enabled, true)
        and v_user_module_in_app_enabled
      )
     ) then
    insert into public.notifications (
      user_id,
      type,
      category,
      title,
      message,
      priority,
      link_url,
      action_url,
      actor_id,
      entity_type,
      entity_id,
      rich_content,
      data,
      created_at
    ) values (
      p_user_id,
      p_type,
      p_category,
      p_title,
      p_message,
      p_priority,
      p_link_url,
      p_link_url,
      p_actor_id,
      p_entity_type,
      p_entity_id,
      p_rich_content,
      coalesce(p_rich_content, '{}'::jsonb),
      now()
    )
    returning id into v_notification_id;

    return v_notification_id;
  end if;

  return null;
end;
$function$;

REVOKE ALL ON FUNCTION public.create_notification(uuid, text, text, text, text, text, text, uuid, text, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, text, text, text, uuid, text, uuid, jsonb)
  TO authenticated, service_role;
