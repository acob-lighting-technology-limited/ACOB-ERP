-- Allow admins to insert correspondence records on behalf of other users.
-- Previously the policy required originator_id = auth.uid(), which blocked
-- admin-created records where originator_id is a different employee.
DROP POLICY IF EXISTS "correspondence_records_insert" ON public.correspondence_records;
CREATE POLICY "correspondence_records_insert" ON public.correspondence_records FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    AND (originator_id = (SELECT auth.uid()) OR correspondence_is_admin())
  );
