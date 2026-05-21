ALTER TABLE public.pending_users
ADD COLUMN IF NOT EXISTS gender text;

ALTER TABLE public.pending_users
ADD COLUMN IF NOT EXISTS date_of_birth date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_users_gender_check'
  ) THEN
    ALTER TABLE public.pending_users
    ADD CONSTRAINT pending_users_gender_check
    CHECK (gender IS NULL OR gender IN ('male', 'female', 'prefer_not_to_say', 'unspecified'));
  END IF;
END
$$;
