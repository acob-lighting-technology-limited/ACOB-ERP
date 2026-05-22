-- Fix: counter was out of sync with existing reference_number values in the
-- records table, causing duplicate key violations when the counter was behind
-- the actual highest assigned number.
--
-- The new approach:
--   1. Ensure the counter row exists (INSERT ... DO NOTHING).
--   2. UPDATE the row (which acquires a row-level lock) setting last_number to
--      MAX(current counter, highest existing reference with this prefix) + 1.
-- Step 2 is atomic per-row: concurrent sessions are serialised by the row lock,
-- so there is no window for two sessions to compute the same next number.

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

  -- Ensure the counter row exists before we try to lock it.
  INSERT INTO public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
  VALUES (v_key, v_year, 0, now(), now())
  ON CONFLICT (counter_key, year) DO NOTHING;

  -- Lock the row and advance to MAX(counter, highest existing ref) + 1.
  -- The UPDATE acquires the row lock so concurrent calls are serialised here;
  -- each session sees the result written by the previous one.
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

  RETURN v_prefix || LPAD(v_next::TEXT, 3, '0');
END;
$$;
