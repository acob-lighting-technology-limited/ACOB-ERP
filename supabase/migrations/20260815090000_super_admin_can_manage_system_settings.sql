-- Super admins can manage operational system settings.
--
-- Before this, `system_settings` granted writes to the `developer` role only, so
-- an authorised super_admin or admin editing the attendance policy at
-- /admin/settings/attendance was rejected by RLS with
-- "new row violates row-level security policy". The API routes work around it by
-- writing through the service-role client after their own route-level checks;
-- this policy closes the gap at the database level too, so the protection does
-- not depend solely on which client a route happens to use.
--
-- `maintenance_mode` stays developer-only on purpose: /admin/dev is developer-only
-- (see canAccessRouteV2), and putting the whole platform into maintenance is not a
-- super_admin action. Every other key is operational configuration.
--
-- has_role('super_admin') is true for both super_admin and developer, so the
-- existing developer policy is unaffected and still applies in full.

drop policy if exists "Super admins can manage operational settings" on public.system_settings;

create policy "Super admins can manage operational settings"
  on public.system_settings
  for all
  to authenticated
  using (has_role('super_admin') and key <> 'maintenance_mode')
  with check (has_role('super_admin') and key <> 'maintenance_mode');
