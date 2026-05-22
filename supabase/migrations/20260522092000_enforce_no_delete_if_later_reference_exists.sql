-- Prevent deleting a correspondence record when a later reference in the
-- same sequence exists. E.g. you cannot delete .../2026/001 if .../2026/002
-- is present. This rule applies to every caller including service_role.
--
-- Records with no reference_number (drafts that were never approved) may
-- still be deleted freely.

CREATE OR REPLACE FUNCTION public.correspondence_before_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ref    TEXT;
  v_prefix TEXT;
  v_seq    INTEGER;
  v_count  INTEGER;
BEGIN
  v_ref := NULLIF(TRIM(COALESCE(OLD.reference_number, '')), '');

  -- Draft / unassigned records have no reference — allow deletion.
  IF v_ref IS NULL THEN
    RETURN OLD;
  END IF;

  -- Derive prefix (everything up to and including the last '/') and sequence number.
  -- Format is:  ACOB/{seg1}/{seg2}/{year}/{nnn}
  v_prefix := LEFT(v_ref, length(v_ref) - length(split_part(v_ref, '/', 5)));
  v_seq    := (split_part(v_ref, '/', 5))::integer;

  -- Count how many approved-family records share the same prefix with a
  -- higher sequence number.
  SELECT COUNT(*) INTO v_count
  FROM public.correspondence_records
  WHERE reference_number LIKE (v_prefix || '%')
    AND (split_part(reference_number, '/', 5))::integer > v_seq
    AND id <> OLD.id;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete correspondence record % — later reference(s) in the same sequence exist (% found). Delete or reassign those first.',
      v_ref, v_count;
  END IF;

  RETURN OLD;
END;
$$;

-- Drop old trigger if it exists, then (re)create.
DROP TRIGGER IF EXISTS trg_correspondence_records_before_delete ON public.correspondence_records;

CREATE TRIGGER trg_correspondence_records_before_delete
BEFORE DELETE ON public.correspondence_records
FOR EACH ROW EXECUTE FUNCTION public.correspondence_before_delete();
