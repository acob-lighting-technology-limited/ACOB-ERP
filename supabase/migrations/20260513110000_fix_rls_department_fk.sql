-- Use FK-based department checks in RLS policies instead of text comparisons.

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id);

UPDATE public.action_items t
SET department_id = d.id
FROM public.departments d
WHERE d.name = t.department
  AND t.department_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_action_items_department_id
  ON public.action_items (department_id);

-- Action items policies
DROP POLICY IF EXISTS "Users can view action items for their department" ON public.action_items;
DROP POLICY IF EXISTS "Users can update action items" ON public.action_items;
DROP POLICY IF EXISTS "Users can update own dept action items" ON public.action_items;
DROP POLICY IF EXISTS "Leads and admins can update department action items" ON public.action_items;
DROP POLICY IF EXISTS "Users can delete action items" ON public.action_items;
DROP POLICY IF EXISTS "Only admins can delete action items" ON public.action_items;

CREATE POLICY "Users can view action items for their department"
  ON public.action_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = action_items.department_id)
          OR p.department_id = action_items.department_id
        )
    )
  );

CREATE POLICY "Leads and admins can update department action items"
  ON public.action_items FOR UPDATE
  USING (
    auth.uid() = assigned_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = action_items.department_id)
        )
    )
  )
  WITH CHECK (
    auth.uid() = assigned_by
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = action_items.department_id)
        )
    )
  );

CREATE POLICY "Only admins can delete action items"
  ON public.action_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'developer')
    )
  );

-- Weekly reports policies
DROP POLICY IF EXISTS "Leads can manage their own reports" ON public.weekly_reports;
DROP POLICY IF EXISTS "Leads and admins can update weekly reports" ON public.weekly_reports;
DROP POLICY IF EXISTS "Only admins can delete weekly reports" ON public.weekly_reports;
DROP POLICY IF EXISTS "Leads and admins can insert weekly reports" ON public.weekly_reports;

CREATE POLICY "Leads and admins can update weekly reports"
  ON public.weekly_reports FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = weekly_reports.department_id)
        )
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = weekly_reports.department_id)
        )
    )
  );

CREATE POLICY "Leads and admins can insert weekly reports"
  ON public.weekly_reports FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'super_admin', 'developer')
          OR (p.is_department_lead = true AND p.department_id = weekly_reports.department_id)
        )
    )
  );

CREATE POLICY "Only admins can delete weekly reports"
  ON public.weekly_reports FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'developer')
    )
  );

-- Assets select policy department check should also use FK ids.
DROP POLICY IF EXISTS "Assets select policy" ON public.assets;
CREATE POLICY "Assets select policy"
  ON public.assets
  FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT has_role('staff'::text) AS has_role)
      OR (SELECT has_role('admin'::text) AS has_role)
      OR (
        (SELECT has_role('lead'::text) AS has_role)
        AND department_id = (
          SELECT p.department_id
          FROM public.profiles p
          WHERE p.id = (SELECT auth.uid() AS uid)
          LIMIT 1
        )
      )
    )
  );
