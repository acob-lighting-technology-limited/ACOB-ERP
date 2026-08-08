-- Two related read-access fixes for staff (non-admin, non-lead) accounts.
--
-- 1. Name resolution. `profiles` SELECT is restricted to self / admin-like / own
--    lead departments, so a plain employee could read exactly one profile row:
--    their own. Every report screen that maps an id to a name (KSS presenter,
--    KSS "Submitted By", Minutes "Uploaded By", Weekly Reports "Submitted By")
--    therefore rendered "Unknown" for everyone but themselves, and department
--    filter dropdowns came back with a single entry.
--
--    Rather than widening `profiles` itself — which is row-level, not
--    column-level, and would hand every employee DOB, address, employee number
--    and other HR fields — expose a view carrying exactly the column set that
--    /api/directory already serves org-wide to every authenticated employee.
--    Anything the directory does not show, this view does not show.
--
-- 2. Minutes + KSS documents. `meeting_week_documents_select` required
--    admin-like OR is_department_lead, while
--    app/api/reports/meeting-week-documents/route.ts explicitly treats minutes
--    and knowledge_sharing_session as staff-readable. The route allowed the
--    read and RLS then returned zero rows, so Minutes of Meeting rendered empty
--    and every KSS download failed with "no uploaded file". Add a staff read
--    policy for those two types only; attendance and transcript stay
--    admin/lead-only.
--
-- Note on grants: 20260709120000 revoked employee_directory / profiles_public
-- from anon + authenticated because they had been granted to anon, whose key
-- ships in the browser. That lesson is applied here — this view is granted to
-- `authenticated` ONLY, with an explicit revoke of anon and PUBLIC.

-- ---------------------------------------------------------------------------
-- 1. Staff-readable directory view
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.staff_directory AS
SELECT
  id,
  first_name,
  last_name,
  full_name,
  company_email,
  additional_email,
  phone_number,
  additional_phone,
  department,
  designation,
  office_location,
  is_department_lead,
  lead_departments,
  employment_status
FROM public.profiles;

-- Must bypass the caller's RLS on `profiles` — that restriction is the whole
-- reason this view exists. security_invoker = true would reproduce the bug.
ALTER VIEW public.staff_directory SET (security_invoker = false);

-- Exited staff are intentionally included: their names still have to render on
-- historical KSS rows, minutes and weekly reports. /api/directory keeps its own
-- exited filter for the live directory listing.

REVOKE ALL ON public.staff_directory FROM anon, PUBLIC;
GRANT SELECT ON public.staff_directory TO authenticated;

COMMENT ON VIEW public.staff_directory IS
  'Org-wide staff lookup for authenticated users. Column set is deliberately identical to DIRECTORY_COLUMNS in app/api/directory/route.ts — contact fields only, no DOB/salary/employee_number/leave/attendance. Never grant to anon.';

-- ---------------------------------------------------------------------------
-- 2. Staff read access to minutes + KSS documents
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS meeting_week_documents_select_staff_readable ON public.meeting_week_documents;
CREATE POLICY meeting_week_documents_select_staff_readable
ON public.meeting_week_documents
FOR SELECT
TO authenticated
USING (document_type IN ('minutes', 'knowledge_sharing_session'));
