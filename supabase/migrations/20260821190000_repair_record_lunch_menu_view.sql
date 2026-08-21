-- Repair: 20260820153000 is recorded as applied and its table exists, but
-- public.record_lunch_menu_view was never created in the remote database, so
-- every POST /api/hr/lunch/view failed with PGRST202 and the admin Views
-- column stayed at 0. Re-create the function exactly as that migration defines
-- it (idempotent, safe to re-run).
create or replace function public.record_lunch_menu_view(p_menu_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'record_lunch_menu_view requires an authenticated caller';
  end if;

  insert into public.lunch_menu_views (menu_id, user_id, first_viewed_at, last_viewed_at, view_count)
  values (p_menu_id, v_user_id, now(), now(), 1)
  on conflict (menu_id, user_id) do update
    set last_viewed_at = now(),
        view_count = public.lunch_menu_views.view_count + 1,
        updated_at = now();
end;
$$;

revoke execute on function public.record_lunch_menu_view(uuid) from anon, public;
grant execute on function public.record_lunch_menu_view(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
