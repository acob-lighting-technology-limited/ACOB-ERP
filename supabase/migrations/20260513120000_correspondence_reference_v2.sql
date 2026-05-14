-- Correspondence Reference Generator v2
-- Changes:
--   • Remove direction column (no incoming/outgoing concept)
--   • Add recipient_code column (proper column, required for all records)
--   • Add created_by_id column (immutable — who typed the record)
--   • Add correspondence_categories table (dynamic, user-defined)
--   • Add category code to reference: ACOB/{DEPT}/{RECIPIENT}/{CAT}/{YEAR}/{NNN}
--   • Counter is unique per dept+recipient+category+year
--   • Default letter_type = 'external'
--   • due_date enforced as required in trigger (not DB NOT NULL to allow migration)
--
-- DATA CLEANUP — run this manually in Supabase SQL editor BEFORE populating real data:
--   TRUNCATE correspondence_events, correspondence_approvals, correspondence_versions CASCADE;
--   TRUNCATE correspondence_records CASCADE;
--   TRUNCATE correspondence_counters;

-- ── Schema changes ──────────────────────────────────────────────────────────────

-- Drop the direction-based check constraint on the table before removing the column
ALTER TABLE public.correspondence_records
  DROP CONSTRAINT IF EXISTS correspondence_records_direction_check;

ALTER TABLE public.correspondence_records
  DROP CONSTRAINT IF EXISTS correspondence_records_check;

-- Drop old category CHECK and replace with open (non-empty only) constraint
ALTER TABLE public.correspondence_records
  DROP CONSTRAINT IF EXISTS correspondence_records_category_check;

ALTER TABLE public.correspondence_records
  ADD CONSTRAINT correspondence_records_category_nonempty
  CHECK (category IS NULL OR LENGTH(TRIM(category)) > 0);

-- Remove direction column (no incoming/outgoing in this system)
ALTER TABLE public.correspondence_records
  DROP COLUMN IF EXISTS direction;

-- Add recipient_code as a proper column
ALTER TABLE public.correspondence_records
  ADD COLUMN IF NOT EXISTS recipient_code TEXT;

-- Add created_by_id (immutable — set by trigger on INSERT, never updated)
ALTER TABLE public.correspondence_records
  ADD COLUMN IF NOT EXISTS created_by_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── correspondence_categories table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.correspondence_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  code        TEXT        NOT NULL,
  created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(code)
);

INSERT INTO public.correspondence_categories (name, code) VALUES
  ('Approval',         'APR'),
  ('Notice',           'NTC'),
  ('Contract',         'CTR'),
  ('Invoice',          'INV'),
  ('Proposal',         'PROP'),
  ('Reference Letter', 'REF'),
  ('Security',         'SEC')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.correspondence_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read correspondence categories" ON public.correspondence_categories;
DROP POLICY IF EXISTS "Authenticated can insert correspondence categories" ON public.correspondence_categories;

CREATE POLICY "Authenticated can read correspondence categories"
  ON public.correspondence_categories FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can insert correspondence categories"
  ON public.correspondence_categories FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Drop old generate_correspondence_reference overloads ─────────────────────

-- Drop all previous signatures so we can create a clean new one
DROP FUNCTION IF EXISTS public.generate_correspondence_reference(text, text, text, text, integer);
DROP FUNCTION IF EXISTS public.generate_correspondence_reference(text, text, text, integer);
DROP FUNCTION IF EXISTS public.generate_correspondence_reference(text, integer);

-- ── New generate_correspondence_reference (no direction, adds category) ─────

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

  v_key := format('outgoing:%s:%s:%s', v_dept, v_recipient, COALESCE(v_cat, ''));

  IF v_cat IS NOT NULL THEN
    v_prefix := format('%s/%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_cat, v_year::TEXT);
  ELSE
    v_prefix := format('%s/%s/%s/%s/', v_company, v_dept, v_recipient, v_year::TEXT);
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

-- ── Updated correspondence_before_insert trigger function ────────────────────

CREATE OR REPLACE FUNCTION public.correspondence_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_department_code TEXT;
  v_year            INTEGER;
  v_recipient_code  TEXT;
  v_category_code   TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- created_by_id is always the actual logged-in user, immutable
  NEW.created_by_id := auth.uid();

  -- originator_id defaults to current user if not provided (for on-behalf entry)
  IF NEW.originator_id IS NULL THEN
    NEW.originator_id := auth.uid();
  END IF;

  IF NEW.reference_number IS NOT NULL AND BTRIM(NEW.reference_number) <> '' AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Reference number is system-generated and cannot be set manually';
  END IF;

  NEW.company_code := COALESCE(NULLIF(TRIM(NEW.company_code), ''), 'ACOB');
  v_year := EXTRACT(YEAR FROM COALESCE(NEW.submitted_at, NEW.created_at, now()))::INTEGER;

  -- department_name required
  IF NEW.department_name IS NULL OR BTRIM(NEW.department_name) = '' THEN
    RAISE EXCEPTION 'department_name is required';
  END IF;

  -- recipient_code required
  IF NEW.recipient_code IS NULL OR BTRIM(NEW.recipient_code) = '' THEN
    RAISE EXCEPTION 'recipient_code is required';
  END IF;
  NEW.recipient_code := UPPER(TRIM(NEW.recipient_code));

  -- due_date required
  IF NEW.due_date IS NULL THEN
    RAISE EXCEPTION 'due_date is required';
  END IF;

  -- default letter_type to 'external'
  IF NEW.letter_type IS NULL THEN
    NEW.letter_type := 'external';
  END IF;

  -- resolve department_code from department_codes table
  SELECT c.department_code INTO v_department_code
  FROM public.correspondence_department_codes c
  WHERE c.department_name = NEW.department_name AND c.is_active = true
  LIMIT 1;

  IF v_department_code IS NULL AND NEW.department_code IS NOT NULL AND BTRIM(NEW.department_code) <> '' THEN
    v_department_code := UPPER(BTRIM(NEW.department_code));
  END IF;

  IF v_department_code IS NULL THEN
    RAISE EXCEPTION 'No active department code configured for %', NEW.department_name;
  END IF;

  NEW.department_code := v_department_code;

  IF NEW.status IS NULL THEN
    NEW.status := 'draft';
  END IF;

  -- derive category_code from correspondence_categories table (match by code or name)
  IF NEW.category IS NOT NULL AND BTRIM(NEW.category) <> '' THEN
    SELECT cc.code INTO v_category_code
    FROM public.correspondence_categories cc
    WHERE LOWER(cc.code) = LOWER(TRIM(NEW.category))
       OR LOWER(cc.name) = LOWER(TRIM(NEW.category))
    LIMIT 1;

    -- if not found in table, use the value directly as the code (custom/free-form)
    IF v_category_code IS NULL THEN
      v_category_code := UPPER(REGEXP_REPLACE(TRIM(NEW.category), '[^A-Z0-9\-]', '', 'gi'));
      IF v_category_code = '' THEN
        v_category_code := NULL;
      END IF;
    END IF;
  END IF;

  -- generate reference number
  IF NEW.reference_number IS NULL OR BTRIM(NEW.reference_number) = '' THEN
    NEW.reference_number := public.generate_correspondence_reference(
      NEW.department_code,
      NEW.recipient_code,
      v_category_code,
      NEW.company_code,
      v_year
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ── Updated correspondence_before_update trigger function ────────────────────

CREATE OR REPLACE FUNCTION public.correspondence_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.reference_number IS DISTINCT FROM NEW.reference_number THEN
    RAISE EXCEPTION 'Reference number cannot be modified';
  END IF;

  IF OLD.created_by_id IS DISTINCT FROM NEW.created_by_id THEN
    RAISE EXCEPTION 'created_by_id cannot be modified';
  END IF;

  IF OLD.is_locked THEN
    IF OLD.subject IS DISTINCT FROM NEW.subject
      OR OLD.department_name IS DISTINCT FROM NEW.department_name
      OR OLD.department_code IS DISTINCT FROM NEW.department_code
      OR OLD.letter_type IS DISTINCT FROM NEW.letter_type
      OR OLD.category IS DISTINCT FROM NEW.category
      OR OLD.recipient_name IS DISTINCT FROM NEW.recipient_name
      OR OLD.recipient_code IS DISTINCT FROM NEW.recipient_code
      OR OLD.sender_name IS DISTINCT FROM NEW.sender_name
      OR OLD.due_date IS DISTINCT FROM NEW.due_date
      OR OLD.action_required IS DISTINCT FROM NEW.action_required
      OR OLD.source_mode IS DISTINCT FROM NEW.source_mode
      OR OLD.metadata IS DISTINCT FROM NEW.metadata
    THEN
      RAISE EXCEPTION 'Locked correspondence cannot be edited';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ── Backfill recipient_code from metadata for existing records ───────────────
-- (Only needed if there is existing data; safe to run even if table is empty)

UPDATE public.correspondence_records
SET recipient_code = UPPER(
  COALESCE(
    NULLIF(TRIM(metadata ->> 'recipient_code'), ''),
    NULLIF(TRIM(recipient_name), ''),
    'GEN'
  )
)
WHERE recipient_code IS NULL;

-- ── Rebuild counters to include category segment ─────────────────────────────
-- This resets all outgoing counters to match the new key format.
-- Safe to run now; will be reset again after data cleanup anyway.

DELETE FROM public.correspondence_counters
WHERE counter_key LIKE 'outgoing:%';

INSERT INTO public.correspondence_counters (counter_key, year, last_number, created_at, updated_at)
SELECT
  format(
    'outgoing:%s:%s:',
    SPLIT_PART(reference_number, '/', 2),
    SPLIT_PART(reference_number, '/', 3)
  ) AS counter_key,
  SPLIT_PART(reference_number, '/', 4)::INT AS year,
  MAX(SPLIT_PART(reference_number, '/', 5)::INT) AS last_number,
  now(),
  now()
FROM public.correspondence_records
WHERE reference_number ~ '^[^/]+/[A-Z0-9\-]+/[A-Z0-9\-]+/[0-9]{4}/[0-9]{3}$'
GROUP BY 1, 2
ON CONFLICT (counter_key, year) DO UPDATE
SET last_number = EXCLUDED.last_number, updated_at = now();
