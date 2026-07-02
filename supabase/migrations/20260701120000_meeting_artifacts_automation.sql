-- Teams meeting artifact automation.
--
-- Adds two new stored document types (attendance, transcript) to the existing
-- meeting_week_documents repository, plus:
--   * meeting_artifact_sources  — which Teams meeting(s) to watch (join URL,
--     organizer, recipients, enable/disable). Seeded/edited from the Reports UI.
--   * meeting_artifact_ledger   — dedupe ledger so each Graph artifact is only
--     imported + emailed once.
-- A weekday pg_cron job pokes the sync-meeting-artifacts edge function, which
-- self-gates on the ERP effective meeting date so it only acts on meeting day.

-- ── 1. Allow the two new document types in the shared repository ──────────────
alter table public.meeting_week_documents
  drop constraint if exists meeting_week_documents_type_check;
alter table public.meeting_week_documents
  add constraint meeting_week_documents_type_check
  check (document_type in ('knowledge_sharing_session', 'minutes', 'action_points', 'attendance', 'transcript'));

-- Auto-imported artifacts have no human uploader — allow a null uploaded_by.
alter table public.meeting_week_documents
  alter column uploaded_by drop not null;

-- attendance/transcript never carry a department (org-wide meeting artifacts).
alter table public.meeting_week_documents
  drop constraint if exists meeting_week_documents_kss_department_check;
alter table public.meeting_week_documents
  add constraint meeting_week_documents_kss_department_check
  check (
    (document_type = 'knowledge_sharing_session' and department is not null)
    or (document_type in ('minutes', 'action_points', 'attendance', 'transcript'))
  );

-- Widen the storage-bucket MIME allowlist so native attendance (CSV/XLSX) and
-- transcript (DOCX/VTT/TXT) files are accepted when OneDrive is not the target.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meeting_documents',
  'meeting_documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/vtt',
    'text/plain'
  ]
)
on conflict (id) do update
set allowed_mime_types = excluded.allowed_mime_types;

-- ── 2. Config: which meeting(s) to watch ─────────────────────────────────────
create table if not exists public.meeting_artifact_sources (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  join_web_url text not null,
  organizer_email text not null,
  recipients text[] not null default array[]::text[],
  email_enabled boolean not null default true,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_artifact_sources_join_url_unique unique (join_web_url)
);

create index if not exists idx_meeting_artifact_sources_active
  on public.meeting_artifact_sources(is_active);

-- ── 3. Dedupe ledger: one import+email per Graph artifact ─────────────────────
create table if not exists public.meeting_artifact_ledger (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.meeting_artifact_sources(id) on delete cascade,
  graph_online_meeting_id text not null,
  artifact_type text not null,
  artifact_graph_id text not null,
  meeting_week integer,
  meeting_year integer,
  document_id uuid references public.meeting_week_documents(id) on delete set null,
  emailed_at timestamptz,
  processed_at timestamptz not null default now(),
  constraint meeting_artifact_ledger_type_check check (artifact_type in ('attendance', 'transcript')),
  constraint meeting_artifact_ledger_unique unique (artifact_type, artifact_graph_id)
);

create index if not exists idx_meeting_artifact_ledger_source
  on public.meeting_artifact_ledger(source_id);
create index if not exists idx_meeting_artifact_ledger_meeting
  on public.meeting_artifact_ledger(graph_online_meeting_id);

-- ── 4. RLS — reports admins manage config; service_role runs the sync ─────────
alter table public.meeting_artifact_sources enable row level security;
alter table public.meeting_artifact_ledger enable row level security;

drop policy if exists "meeting_artifact_sources_select" on public.meeting_artifact_sources;
create policy "meeting_artifact_sources_select"
on public.meeting_artifact_sources
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(p.role::text)) in ('developer', 'super_admin', 'admin')
  )
);

drop policy if exists "meeting_artifact_sources_write" on public.meeting_artifact_sources;
create policy "meeting_artifact_sources_write"
on public.meeting_artifact_sources
for all
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        lower(trim(p.role::text)) in ('developer', 'super_admin')
        or (
          lower(trim(p.role::text)) = 'admin'
          and (p.admin_domains is null or 'reports' = any (p.admin_domains))
        )
      )
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (
        lower(trim(p.role::text)) in ('developer', 'super_admin')
        or (
          lower(trim(p.role::text)) = 'admin'
          and (p.admin_domains is null or 'reports' = any (p.admin_domains))
        )
      )
  )
);

-- Ledger is written only by the service-role edge function; admins may read it.
drop policy if exists "meeting_artifact_ledger_select" on public.meeting_artifact_ledger;
create policy "meeting_artifact_ledger_select"
on public.meeting_artifact_ledger
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and lower(trim(p.role::text)) in ('developer', 'super_admin', 'admin')
  )
);

grant all on table public.meeting_artifact_sources to authenticated, service_role;
grant all on table public.meeting_artifact_ledger to authenticated, service_role;

-- ── 5. updated_at trigger (reuse the shared meeting-docs helper) ──────────────
drop trigger if exists trg_meeting_artifact_sources_updated_at on public.meeting_artifact_sources;
create trigger trg_meeting_artifact_sources_updated_at
before update on public.meeting_artifact_sources
for each row
execute function public.meeting_docs_set_updated_at();

-- ── 6. Cron: poke the sync edge function on weekday afternoons (UTC). ─────────
-- The meeting runs mornings Lagos time (UTC+1); artifacts/transcripts settle by
-- early afternoon. The edge function self-gates on the ERP effective meeting
-- date, so off-days and off-weeks are cheap no-ops; the ledger dedupes reruns.
select cron.schedule(
  'sync-meeting-artifacts',
  '*/20 11-16 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://itqegqxeqkeogwrvlzlj.supabase.co/functions/v1/sync-meeting-artifacts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cWVncXhlcWtlb2d3cnZsemxqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE2NDI0NTcsImV4cCI6MjA3NzIxODQ1N30.eVYpuw_VqDrg28DXJFoeYGAbth4Q-t0tXokA1Nq1dog"}'::jsonb,
    body := '{}'::jsonb
  );
  $job$
);
