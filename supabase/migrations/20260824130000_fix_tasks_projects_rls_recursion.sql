-- The "Tasks select policy" (20260823090000) and "Projects select scoped"
-- policy (20260821160000) each embed a correlated subquery into the other's
-- table:
--   tasks    -> EXISTS (select 1 from projects where project_manager_id = auth.uid())
--   projects -> EXISTS (select 1 from tasks    where assigned_to = auth.uid())
--
-- Evaluating either policy requires evaluating the other table's RLS, which
-- requires evaluating the first table's RLS again -- Postgres detects this
-- and raises "infinite recursion detected in policy for relation tasks/projects"
-- for every non-admin/non-lead select, even ones that never reach that clause
-- (RLS quals are planned as a whole, not short-circuited before planning).
--
-- Fix: move each cross-table check into a SECURITY DEFINER function. Function
-- bodies run as the function owner (bypasses RLS), so the inner query no
-- longer re-triggers the other table's policy -- same pattern already used by
-- is_project_member()/is_admin_like().

create or replace function public.is_project_manager_of(project_uuid uuid, user_uuid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = project_uuid
      and p.project_manager_id = user_uuid
  );
$$;

create or replace function public.has_assigned_task_in_project(project_uuid uuid, user_uuid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tasks t
    where t.project_id = project_uuid
      and t.assigned_to = user_uuid
  );
$$;

drop policy if exists "Tasks select policy" on public.tasks;
create policy "Tasks select policy"
on public.tasks for select to authenticated
using (
  (select public.has_role('admin'))
  or (select public.has_role('lead'))
  or assigned_to = auth.uid()
  or assigned_by = auth.uid()
  or exists (select 1 from public.task_assignments ta where ta.task_id = tasks.id and ta.user_id = auth.uid())
  or public.is_project_manager_of(tasks.project_id, auth.uid())
  or (
    tasks.assignment_type = 'department'
    and tasks.department is not null
    and tasks.department = (select pr.department from public.profiles pr where pr.id = auth.uid())
  )
);

drop policy if exists "Projects select scoped" on public.projects;
create policy "Projects select scoped"
on public.projects for select to authenticated
using (
  public.is_admin_like()
  or created_by = auth.uid()
  or project_manager_id = auth.uid()
  or public.is_project_member(id, auth.uid())
  or public.has_assigned_task_in_project(id, auth.uid())
);
