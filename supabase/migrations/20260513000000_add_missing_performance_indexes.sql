-- Missing indexes on heavily-filtered columns.
-- These columns appear in WHERE clauses across dozens of queries but had no indexes.

-- profiles.role is filtered in ~100 queries (admin checks, scope resolution, RBAC)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);

-- profiles.employment_status is filtered in employee listing and suspension checks
CREATE INDEX IF NOT EXISTS idx_profiles_employment_status ON public.profiles (employment_status);

-- attendance_records.date is filtered in every clock-in, clock-out, and attendance report
CREATE INDEX IF NOT EXISTS idx_attendance_records_date ON public.attendance_records (date);

-- Composite index for the common (user_id, date) lookup pattern used in clock-in/clock-out
CREATE INDEX IF NOT EXISTS idx_attendance_records_user_date ON public.attendance_records (user_id, date);

-- leave_requests.status is filtered in every leave management view
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON public.leave_requests (status);

-- help_desk_tickets: common filter is (service_department, status) for queue views
CREATE INDEX IF NOT EXISTS idx_help_desk_tickets_dept_status ON public.help_desk_tickets (service_department, status);

-- help_desk_tickets.created_at is used for ordering in all ticket lists
CREATE INDEX IF NOT EXISTS idx_help_desk_tickets_created_at ON public.help_desk_tickets (created_at DESC);

-- audit_logs.created_at for ordering in the audit trail viewer
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);

-- notifications: common lookup is (user_id, read) for unread count badges
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications (user_id, read);
