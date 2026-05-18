-- 1. Remove category from reference number format.
--    Category stays on the record as metadata/filter but is no longer
--    embedded in the reference string. Existing references are unchanged.
--
-- 2. Fix department code lookup in the insert trigger to use the
--    departments table (single source of truth) instead of the legacy
--    correspondence_department_codes table.

-- ── Updated generate_correspondence_reference (no category in ref) ───────────

CREATE OR REPLACE FUNCTION public.generate_correspondence_reference(
  p_department_code TEXT,
  p_recipient_code  TEXT,
  p_category_code   TEXT    DEFAULT NULL,  -- kept for signature compatibility, ignored
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

  -- Counter key: dept + recipient only (category no longer part of the sequence)
  v_key    := format('outgoing:%s:%s', v_dept, v_recipient);
  v_prefix := format('%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_year::TEXT);

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

-- ── Updated correspondence_before_insert trigger ─────────────────────────────
-- Reads department_code from the departments table (single source of truth)
-- and no longer passes category to the reference generator.

CREATE OR REPLACE FUNCTION public.correspondence_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_department_code TEXT;
  v_year            INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  NEW.created_by_id := auth.uid();

  IF NEW.originator_id IS NULL THEN
    NEW.originator_id := auth.uid();
  END IF;

  IF NEW.reference_number IS NOT NULL AND BTRIM(NEW.reference_number) <> '' AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Reference number is system-generated and cannot be set manually';
  END IF;

  NEW.company_code := COALESCE(NULLIF(TRIM(NEW.company_code), ''), 'ACOB');
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.submitted_at, NEW.created_at, now()))::INTEGER;

  IF NEW.department_name IS NULL OR BTRIM(NEW.department_name) = '' THEN
    RAISE EXCEPTION 'department_name is required';
  END IF;

  IF NEW.recipient_code IS NULL OR BTRIM(NEW.recipient_code) = '' THEN
    RAISE EXCEPTION 'recipient_code is required';
  END IF;
  NEW.recipient_code := UPPER(TRIM(NEW.recipient_code));

  IF NEW.due_date IS NULL THEN
    RAISE EXCEPTION 'due_date is required';
  END IF;

  IF NEW.letter_type IS NULL THEN
    NEW.letter_type := 'external';
  END IF;

  -- Resolve department_code from departments table (single source of truth)
  SELECT d.department_code INTO v_department_code
  FROM public.departments d
  WHERE lower(trim(d.name)) = lower(trim(NEW.department_name))
    AND d.is_active = true
    AND d.department_code IS NOT NULL
  LIMIT 1;

  -- Fallback: if the record already carries a department_code use it
  IF v_department_code IS NULL AND NEW.department_code IS NOT NULL AND BTRIM(NEW.department_code) <> '' THEN
    v_department_code := UPPER(BTRIM(NEW.department_code));
  END IF;

  IF v_department_code IS NULL THEN
    RAISE EXCEPTION 'No department code configured for department "%". Please set a code in Admin → HR → Departments.', NEW.department_name;
  END IF;

  NEW.department_code := v_department_code;

  IF NEW.status IS NULL THEN
    NEW.status := 'draft';
  END IF;

  -- Generate reference number (category intentionally excluded)
  IF NEW.reference_number IS NULL OR BTRIM(NEW.reference_number) = '' THEN
    NEW.reference_number := public.generate_correspondence_reference(
      NEW.department_code,
      NEW.recipient_code,
      NULL,              -- category_code ignored
      NEW.company_code,
      v_year
    );
  END IF;

  RETURN NEW;
END;
$$;
