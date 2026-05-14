CREATE OR REPLACE FUNCTION public.atomic_dispatch_correspondence(
  p_record_id uuid,
  p_actor_id uuid,
  p_final_status text,
  p_dispatch_method text,
  p_proof_of_delivery_path text,
  p_recipient_name text,
  p_old_status text
)
RETURNS correspondence_records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record correspondence_records;
BEGIN
  UPDATE correspondence_records
  SET status = p_final_status,
      dispatch_method = p_dispatch_method,
      proof_of_delivery_path = p_proof_of_delivery_path,
      recipient_name = p_recipient_name,
      sent_at = NOW(),
      is_locked = true,
      updated_at = NOW()
  WHERE id = p_record_id
  RETURNING * INTO v_record;

  INSERT INTO correspondence_events (
    correspondence_id,
    actor_id,
    event_type,
    old_status,
    new_status,
    details
  ) VALUES (
    p_record_id,
    p_actor_id,
    'dispatched',
    p_old_status,
    p_final_status,
    jsonb_build_object(
      'dispatch_method', p_dispatch_method,
      'proof_of_delivery_path', p_proof_of_delivery_path
    )
  );

  RETURN v_record;
END;
$$;
