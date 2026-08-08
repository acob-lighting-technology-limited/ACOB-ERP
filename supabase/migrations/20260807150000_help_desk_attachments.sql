-- Document support for help desk tickets.
--
-- Tickets could only ever carry free text, so anyone reporting a fault had to
-- describe a screenshot rather than attach it. Mirrors fleet_booking_attachments,
-- which is the existing pattern for per-record files.

insert into storage.buckets (id, name, public)
values ('help_desk_documents', 'help_desk_documents', false)
on conflict (id) do nothing;

create table if not exists public.help_desk_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.help_desk_tickets(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  mime_type text not null,
  file_size bigint not null,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.help_desk_attachments is
  'Files attached to a help desk ticket. Visible to anyone who can already see the ticket.';

create index if not exists idx_help_desk_attachments_ticket on public.help_desk_attachments (ticket_id);

alter table public.help_desk_attachments enable row level security;

-- Attachments inherit the ticket's audience: the requester, the assignee, and
-- the lead of either the requesting or the servicing department. Admin routes
-- use the service-role client and bypass RLS, as elsewhere in this codebase.
drop policy if exists "help_desk_attachments_select" on public.help_desk_attachments;
create policy "help_desk_attachments_select"
  on public.help_desk_attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.help_desk_tickets t
      left join public.profiles me on me.id = (select auth.uid())
      where t.id = help_desk_attachments.ticket_id
        and (
          t.requester_id = (select auth.uid())
          or t.created_by = (select auth.uid())
          or t.assigned_to = (select auth.uid())
          or (
            me.is_department_lead = true
            and (
              t.service_department = me.department
              or t.requester_department = me.department
              or t.service_department = any (coalesce(me.lead_departments, array[]::text[]))
              or t.requester_department = any (coalesce(me.lead_departments, array[]::text[]))
            )
          )
        )
    )
  );

-- Only the uploader creates or removes their own attachment.
drop policy if exists "help_desk_attachments_insert_own" on public.help_desk_attachments;
create policy "help_desk_attachments_insert_own"
  on public.help_desk_attachments
  for insert
  to authenticated
  with check (uploaded_by = (select auth.uid()));

drop policy if exists "help_desk_attachments_delete_own" on public.help_desk_attachments;
create policy "help_desk_attachments_delete_own"
  on public.help_desk_attachments
  for delete
  to authenticated
  using (uploaded_by = (select auth.uid()));
