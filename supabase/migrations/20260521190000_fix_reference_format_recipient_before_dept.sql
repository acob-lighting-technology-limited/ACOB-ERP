-- Fix reference number format: recipient code must come before department code.
-- Correct format: ACOB/{RECIPIENT}/{DEPT}/{YEAR}/{NNN}
-- Previous (wrong) format was: ACOB/{DEPT}/{RECIPIENT}/{YEAR}/{NNN}

CREATE OR REPLACE FUNCTION public.generate_correspondence_reference(
  p_department_code TEXT,
  p_recipient_code  TEXT,
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
  v_year      INTEGER := COALESCE(p_reference_year, EXTRACT(YEAR FROM now())::INTEGER);
  v_dept      TEXT    := UPPER(TRIM(p_department_code));
  v_recipient TEXT    := UPPER(TRIM(p_recipient_code));
  v_cat       TEXT    := NULLIF(TRIM(COALESCE(p_category_code, '')), '');
  v_company   TEXT    := COALESCE(NULLIF(TRIM(p_company_code), ''), 'ACOB');
  v_key       TEXT;
  v_prefix    TEXT;
  v_next      INTEGER;
BEGIN
  IF v_dept IS NULL OR v_dept = '' THEN
    RAISE EXCEPTION 'Department code is required for correspondence references';
  END IF;
  IF v_recipient IS NULL OR v_recipient = '' THEN
    RAISE EXCEPTION 'Recipient code is required for correspondence references';
  END IF;

  -- Counter key: recipient before dept to match reference format
  v_key := format('outgoing:%s:%s:%s', v_recipient, v_dept, COALESCE(v_cat, ''));

  -- Reference prefix: recipient before dept
  IF v_cat IS NOT NULL THEN
    v_prefix := format('%s/%s/%s/%s/%s/', v_company, v_recipient, v_dept, v_cat, v_year::TEXT);
  ELSE
    v_prefix := format('%s/%s/%s/%s/', v_company, v_recipient, v_dept, v_year::TEXT);
  END IF;

  INSERT INTO public.correspondence_counters (counter_key, year, last_number)
  VALUES (v_key, v_year, 0)
  ON CONFLICT (counter_key, year) DO NOTHING;

  PERFORM 1
  FROM public.correspondence_counters
  WHERE counter_key = v_key AND year = v_year
  FOR UPDATE;

  UPDATE public.correspondence_counters
  SET last_number = last_number + 1, updated_at = now()
  WHERE counter_key = v_key AND year = v_year
  RETURNING last_number INTO v_next;

  RETURN v_prefix || LPAD(v_next::TEXT, 3, '0');
END;
$$;
