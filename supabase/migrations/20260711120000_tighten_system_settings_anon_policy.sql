-- Narrow anon SELECT on system_settings to only the maintenance_mode key.
-- Previously anon could read the entire table (qual = true); the only
-- pre-auth need is the maintenance-mode check in lib/supabase/middleware.ts.
DROP POLICY IF EXISTS "Anon can read system settings" ON public.system_settings;
CREATE POLICY "Anon can read maintenance mode only" ON public.system_settings
  FOR SELECT TO anon USING (key = 'maintenance_mode');
