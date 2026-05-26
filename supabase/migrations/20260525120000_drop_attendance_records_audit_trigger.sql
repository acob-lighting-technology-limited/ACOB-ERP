-- Drop the DB-level audit trigger on attendance_records.
--
-- Automated events (Hikvision scans) are not human decisions and do not belong
-- in the audit log. The attendance_records table itself is the source of truth
-- for clock-in/out data.
--
-- Human actions that DO require audit entries (admin manual edits, waivers,
-- remote-access toggles) are handled explicitly by writeAuditLog() calls in
-- the application routes, so nothing meaningful is lost.

DROP TRIGGER IF EXISTS audit_attendance_records_changes ON attendance_records;

NOTIFY pgrst, 'reload schema';
