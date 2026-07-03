-- Second remediation batch (VAPT findings 4-7). Complements 20260703140000.
-- Verified callers:
--   * mark_notifications_read: browser clients pass the caller's OWN user id
--     (notification-content.tsx, notifications.ts, notification-bell.tsx); service role also uses it.
--   * next_employee_number: called ONLY server-side via the service role (approve-user/route.ts).
--   * weekly_reports: read by logged-in employees (authenticated area) + service-role API routes.
--   * crm_pipelines: no direct app query; CRM is staff/admin only.

-- ---- Finding 4: mark_notifications_read IDOR ----
-- Add an ownership guard (owner-only for authenticated callers; service role, where
-- auth.uid() is null, is still allowed) and remove anon execute.
create or replace function public.mark_notifications_read(
  p_user_id uuid,
  p_notification_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_count integer;
begin
  -- Reject any authenticated caller acting on someone else's notifications.
  if auth.uid() is not null and p_user_id <> auth.uid() then
    raise exception 'not authorized to modify notifications for another user';
  end if;

  if p_notification_ids is null then
    update notifications set read = true, read_at = now()
    where user_id = p_user_id and read = false;
  else
    update notifications set read = true, read_at = now()
    where user_id = p_user_id and id = any(p_notification_ids) and read = false;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Revoke both the explicit anon grant AND the default PUBLIC grant that anon
-- inherits (the guard above only blocks authenticated callers; anon has a null
-- auth.uid(), so execute must be removed outright). authenticated keeps its own grant.
revoke execute on function public.mark_notifications_read(uuid, uuid[]) from anon;
revoke execute on function public.mark_notifications_read(uuid, uuid[]) from public;

-- ---- Finding 5: next_employee_number ----
-- Only ever invoked server-side via the service role. Remove all other execute grants.
revoke execute on function public.next_employee_number() from anon;
revoke execute on function public.next_employee_number() from authenticated;
revoke execute on function public.next_employee_number() from public;

-- ---- Finding 6: weekly_reports (submitted reports were anon-readable) ----
drop policy if exists "Everyone can view submitted reports" on public.weekly_reports;
create policy "Authenticated can view submitted reports"
on public.weekly_reports for select to authenticated
using (status = 'submitted' or auth.uid() = user_id);
revoke all on public.weekly_reports from anon;

-- ---- Finding 7: crm_pipelines (active pipeline readable by anon) ----
-- Match the other crm_* tables: staff/admin only, authenticated.
drop policy if exists "Users can view active pipelines" on public.crm_pipelines;
create policy "Staff can view pipelines"
on public.crm_pipelines for select to authenticated
using (has_role('staff') or has_role('admin'));
revoke all on public.crm_pipelines from anon;
