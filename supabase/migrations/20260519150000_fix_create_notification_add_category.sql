-- The create_notification function was omitting `category` from the INSERT,
-- causing a NOT NULL violation that was silently caught by callers.
-- Fix: include category in the INSERT, ensure a safe default exists.

ALTER TABLE public.notifications
  ALTER COLUMN category SET DEFAULT 'system';

CREATE OR REPLACE FUNCTION public.create_notification(
    p_user_id uuid,
    p_type text,
    p_category text DEFAULT 'system',
    p_title text DEFAULT NULL,
    p_message text DEFAULT NULL,
    p_priority text DEFAULT 'normal',
    p_link_url text DEFAULT NULL,
    p_actor_id uuid DEFAULT NULL,
    p_entity_type text DEFAULT NULL,
    p_entity_id text DEFAULT NULL,
    p_rich_content jsonb DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_notification_id UUID;
  v_data JSONB;
BEGIN
  v_data := jsonb_build_object(
    'actor_id', p_actor_id,
    'entity_type', p_entity_type,
    'entity_id', p_entity_id,
    'rich_content', p_rich_content,
    'link_url', p_link_url
  );

  INSERT INTO public.notifications (
    user_id, type, category, title, message, priority, action_url, data
  ) VALUES (
    p_user_id,
    p_type,
    coalesce(p_category, 'system'),
    p_title,
    p_message,
    p_priority,
    p_link_url,
    v_data
  ) RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$function$;
