-- Mark leave requests created directly by an admin via the Attendance Manager (bypassing
-- the normal request/approval workflow) so the manager can list and delete just those,
-- without touching workflow-approved leave.
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS admin_manual boolean NOT NULL DEFAULT false;
