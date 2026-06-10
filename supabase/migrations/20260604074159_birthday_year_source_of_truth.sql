-- Make `birthday` (MM-DD) + `birth_year` the single source of truth for a
-- person's date of birth, and turn `date_of_birth` into a derived value so the
-- two can never disagree.
--
-- Rationale: most employees only have a known month/day (populated by HR into
-- `birthday`); the year is unknown until the person supplies it. Previously
-- `date_of_birth` (a full DATE) and `birthday` (MM-DD) were written
-- independently and could drift apart — the birthday-email cron reads
-- `birthday`, while profile screens read `date_of_birth`. Now `date_of_birth`
-- is recomputed from `birthday` + `birth_year` on every write, so it is always
-- consistent and is NULL whenever the year is unknown.

-- 1. Year-only column (nullable: blank until the person adds their year).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS birth_year smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_birth_year_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_birth_year_check
      CHECK (birth_year IS NULL OR (birth_year BETWEEN 1900 AND 2100));
  END IF;
END
$$;

-- 2. Backfill from any existing full date_of_birth. The HR-curated `birthday`
--    (see 20260520000000) is the authoritative month/day, so it is NEVER
--    overwritten — we only take the YEAR from date_of_birth, and only fill
--    `birthday` from the date when no HR value exists. The trigger below then
--    recomputes date_of_birth from these, reconciling any prior drift in favour
--    of the HR birthday.
UPDATE public.profiles
SET
  birth_year = COALESCE(birth_year, EXTRACT(YEAR FROM date_of_birth)::smallint),
  birthday = COALESCE(birthday, to_char(date_of_birth, 'MM-DD'))
WHERE date_of_birth IS NOT NULL;

-- 3. Derive date_of_birth from birthday + birth_year on every write. Invalid
--    combinations (e.g. Apr 31, or a missing year) resolve to NULL rather than
--    raising, so a partial birthday never blocks a profile save.
CREATE OR REPLACE FUNCTION public.sync_profile_date_of_birth()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.birth_year IS NOT NULL AND NEW.birthday ~ '^[0-9]{1,2}-[0-9]{1,2}$' THEN
    BEGIN
      NEW.date_of_birth := make_date(
        NEW.birth_year::int,
        split_part(NEW.birthday, '-', 1)::int,
        split_part(NEW.birthday, '-', 2)::int
      );
    EXCEPTION WHEN others THEN
      NEW.date_of_birth := NULL;
    END;
  ELSE
    NEW.date_of_birth := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_date_of_birth ON public.profiles;
CREATE TRIGGER trg_sync_profile_date_of_birth
  BEFORE INSERT OR UPDATE OF birthday, birth_year, date_of_birth ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_date_of_birth();
