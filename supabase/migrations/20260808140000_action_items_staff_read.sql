-- Action Tracker was empty for every non-admin, non-lead account.
--
-- The existing SELECT policy is named "Users can view action items for their
-- department" but its USING clause never mentions department — it resolves to
-- role IN (developer, super_admin, admin) OR is_department_lead. A plain
-- employee therefore saw zero rows, while /reports/general-meeting/action-tracker
-- is linked from the employee General Meeting surface.
--
-- Weekly reports already set the precedent: "Authenticated can view submitted
-- reports" makes every submitted report org-wide readable. The general meeting
-- action tracker is the same kind of org-wide reporting artefact, so reads go
-- to all authenticated users.
--
-- Writes are deliberately untouched: INSERT/UPDATE/DELETE remain admin- or
-- lead-scoped via the existing policies, so staff can read the tracker but not
-- edit anyone's action points.

DROP POLICY IF EXISTS "Users can view action items for their department" ON public.action_items;

CREATE POLICY "Authenticated can view action items"
ON public.action_items
FOR SELECT
TO authenticated
USING (true);
