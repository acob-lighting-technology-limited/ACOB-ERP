-- Fix reference format to respect letter_type:
--   internal → ACOB/{recipient_dept}/{request_dept}/year/nnn  (recipient first)
--   external → ACOB/{request_dept}/{recipient}/year/nnn       (dept first — original format)
--
-- Category is intentionally excluded from the reference string; it is stored
-- as metadata only. p_category_code is kept in the signature for call-site
-- compatibility but is ignored when building the reference.

CREATE OR REPLACE FUNCTION public.generate_correspondence_reference(
  p_department_code TEXT,
  p_recipient_code  TEXT,
  p_letter_type     TEXT    DEFAULT 'external',
  p_category_code   TEXT    DEFAULT NULL,   -- kept for signature compat, not used in ref
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
