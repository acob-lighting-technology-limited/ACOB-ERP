-- REDEFINE the correspondence reference number generation logic.
--
-- For internal letters:
--   Format remains: ACOB/{recipient}/{dept}/{year}/[number]
--   Counter key: outgoing:{recipient}:{dept}
--
-- For external letters:
--   Format remains: ACOB/{dept}/{recipient}/{year}/[number]
--   Counter key: outgoing:external:{dept} (shared across all recipients)
--   Prefix query matches: v_company/v_dept/%/v_year/%
--   Sequence extraction counts all existing records for the department and year.

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

  IF v_is_internal THEN
    v_seg1 := v_recipient;
    v_seg2 := v_dept;
    v_key    := format('outgoing:%s:%s', v_seg1, v_seg2);
    v_prefix := format('%s/%s/%s/%s/', v_company, v_seg1, v_seg2, v_year::TEXT);

    -- Ensure the counter row exists before we try to lock it.
    INSERT INTO public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
    VALUES (v_key, v_year, 0, now(), now())
    ON CONFLICT (counter_key, year) DO NOTHING;

    -- Lock the row and advance to MAX(counter, highest existing ref) + 1.
    UPDATE public.correspondence_counters
    SET
      last_number = GREATEST(
        last_number,
        (
          SELECT COALESCE(
            MAX(
              CASE
                WHEN substring(reference_number FROM char_length(v_prefix) + 1) ~ '^[0-9]+$'
                THEN substring(reference_number FROM char_length(v_prefix) + 1)::integer
                ELSE 0
              END
            ),
            0
          )
          FROM public.correspondence_records
          WHERE reference_number LIKE v_prefix || '%'
        )
      ) + 1,
      updated_at = now()
    WHERE counter_key = v_key AND year = v_year
    RETURNING last_number INTO v_next;

  ELSE
    v_key    := format('outgoing:external:%s', v_dept);
    v_prefix := format('%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_year::TEXT);

    -- Ensure the counter row exists before we try to lock it.
    INSERT INTO public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
    VALUES (v_key, v_year, 0, now(), now())
    ON CONFLICT (counter_key, year) DO NOTHING;

    -- Lock the row and advance to GREATEST(counter, COUNT(*) of existing references for this dept & year) + 1.
    UPDATE public.correspondence_counters
    SET
      last_number = GREATEST(
        last_number,
        (
          SELECT COALESCE(COUNT(*), 0)
          FROM public.correspondence_records
          WHERE reference_number LIKE v_company || '/' || v_dept || '/%/' || v_year::TEXT || '/%'
            AND letter_type = 'external'
        )
      ) + 1,
      updated_at = now()
    WHERE counter_key = v_key AND year = v_year
    RETURNING last_number INTO v_next;
  END IF;

  RETURN v_prefix || LPAD(v_next::TEXT, 3, '0');
END;
$$;
