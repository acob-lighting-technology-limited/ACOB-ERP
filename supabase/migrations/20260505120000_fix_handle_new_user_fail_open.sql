-- Prevent auth user creation failures caused by profile trigger drift.
-- This function must never abort auth.users inserts.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    INSERT INTO public.profiles (
      id,
      first_name,
      last_name,
      company_email,
      role,
      employment_status,
      created_at,
      updated_at
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      NEW.email,
      'employee'::public.user_role,
      'active'::public.employment_status,
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      company_email = EXCLUDED.company_email,
      updated_at = NOW();
  EXCEPTION
    WHEN OTHERS THEN
      -- Never block auth account creation because profile insert failed.
      RAISE WARNING 'handle_new_user profile sync failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
