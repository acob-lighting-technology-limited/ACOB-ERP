-- Rejection reasons for the two reject flows that had nowhere to record one.
--
-- Every other reject path in the app already persists an explanation
-- (help_desk_tickets.status_note, requisitions.rejection_reason,
-- correspondence_approvals.comments, leave_evidence.notes,
-- attendance_appeals.resolution_note, fleet_bookings.admin_note). Goal/KPI
-- rejection and pending-user rejection did not, so the person on the receiving
-- end had no idea what to fix.
--
-- Nullable on purpose: historical rows predate the requirement, and the
-- "reason is mandatory" rule is enforced in the API layer alongside the other
-- flows rather than by a NOT NULL constraint that would break those rows.

alter table if exists public.goals_objectives
  add column if not exists rejection_reason text;

comment on column public.goals_objectives.rejection_reason is
  'Why the goal/KPI was rejected. Required by the API when approval_status = ''rejected''.';

alter table if exists public.pending_users
  add column if not exists rejection_reason text;

comment on column public.pending_users.rejection_reason is
  'Why the signup was rejected. Required by the API when status = ''rejected''.';
