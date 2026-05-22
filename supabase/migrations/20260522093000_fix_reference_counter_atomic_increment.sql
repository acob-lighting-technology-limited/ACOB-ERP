-- Fix: replace the two-step INSERT+FOR UPDATE+UPDATE counter pattern with a
-- single atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
-- The old pattern could deadlock / wait indefinitely when two sessions raced
-- to insert the same counter row (one would block on FOR UPDATE forever).

CREATE OR REPLACE FUNCTION public.generate_correspondence_reference(
  p_department_code TEXT,
  p_recipient_code  TEXT,
  p_letter_type     TEXT    DEFAULT 'external',
  p_category_code   TEXT    DEFAULT NULL,
  p_company_code    TEXT    DEFAULT 'ACOB',
  p_reference_year  INTEGER DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_year        INTEGER := COALESCE(p_reference_year, EXTRACT(YEAR FROM now())::INTEGER);
  v_dept        TEXT    := UPPER(TRIM(p_department_code));
  v_recipient   TEXT    := UPPER(TRIM(p_recipient_code));
  v_company     TEXT    := COALESCE(NULLIF(TRIM(p_company_code), ''), 'ACOB');
  v_is_internal BOOLEAN := lower(COALESCE(p_letter_type, 'external')) = 'internal';
  v_seg1        TEXT;
  v_seg2        TEXT;
  v_key         TEXT;
  v_prefix      TEXT;
  v_next        INTEGER;
BEGIN
  IF v_dept IS NULL OR v_dept = '' THEN
    RAISE EXCEPTION 'Department code is required for correspondence references';
  END IF;
  IF v_recipient IS NULL OR v_recipient = '' THEN
    RAISE EXCEPTION 'Recipient code is required for correspondence references';
  END IF;

  -- internal:  ACOB / {recipient} / {dept}      / year / nnn
  -- external:  ACOB / {dept}      / {recipient} / year / nnn
  IF v_is_internal THEN
    v_seg1 := v_recipient;
    v_seg2 := v_dept;
  ELSE
    v_seg1 := v_dept;
    v_seg2 := v_recipient;
  END IF;

  v_key    := format('outgoing:%s:%s', v_seg1, v_seg2);
  v_prefix := format('%s/%s/%s/%s/', v_company, v_seg1, v_seg2, v_year::TEXT);

  -- Atomic increment: insert counter at 1, or bump existing counter by 1.
  -- Single statement eliminates the race between INSERT and the subsequent
  -- FOR UPDATE lock that caused multi-second waits under concurrency.
  INSERT INTO public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
  VALUES (v_key, v_year, 1, now(), now())
  ON CONFLICT (counter_key, year) DO UPDATE
    SET last_number = public.correspondence_counters.last_number + 1,
        updated_at  = now()
  RETURNING last_number INTO v_next;

  RETURN v_prefix || LPAD(v_next::TEXT, 3, '0');
END;
$$;
