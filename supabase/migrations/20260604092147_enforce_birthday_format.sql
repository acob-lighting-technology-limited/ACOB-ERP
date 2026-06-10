-- Enforce the data contract for `birthday` at the database level: it must be a
-- zero-padded MM-DD with a valid month (01-12) and day (01-31), or NULL. This
-- makes the canonical month/day format explicit and rejects malformed values
-- (e.g. '99-99') outright, rather than relying on the derive-DOB trigger to
-- silently null them. Pairs with the existing profiles_birth_year_check.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_birthday_format_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_birthday_format_check
      CHECK (
        birthday IS NULL
        OR (
          birthday ~ '^[0-9]{2}-[0-9]{2}$'
          AND split_part(birthday, '-', 1)::int BETWEEN 1 AND 12
          AND split_part(birthday, '-', 2)::int BETWEEN 1 AND 31
        )
      );
  END IF;
END
$$;
