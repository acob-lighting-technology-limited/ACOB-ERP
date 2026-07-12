-- 1. Create the sync trigger function
CREATE OR REPLACE FUNCTION public.sync_profile_role_to_user_roles()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, NEW.role)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    role = EXCLUDED.role,
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Revoke/Grant permissions for security compliance
REVOKE EXECUTE ON FUNCTION public.sync_profile_role_to_user_roles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_profile_role_to_user_roles() TO authenticated, service_role;

-- 3. Register the trigger on profiles table
DROP TRIGGER IF EXISTS trg_sync_profile_role_to_user_roles ON public.profiles;
CREATE TRIGGER trg_sync_profile_role_to_user_roles
AFTER INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_role_to_user_roles();

-- 4. Backfill all existing profiles into user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT id, role FROM public.profiles
ON CONFLICT (user_id) 
DO UPDATE SET 
  role = EXCLUDED.role,
  updated_at = now();
