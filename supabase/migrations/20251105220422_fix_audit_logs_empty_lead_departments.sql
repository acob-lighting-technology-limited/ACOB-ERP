-- ============================================
-- Fix Audit Logs RLS Policy for Leads with Empty lead_departments
-- ============================================
-- This migration fixes the audit logs RLS policy to use the lead's own department
-- when lead_departments is empty or null

-- Drop existing audit logs policies
DROP POLICY IF EXISTS "super_admin/admin can view all audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Leads can view their department audit logs" ON audit_logs;
-- Create new policy: Super admin and admin can view all audit logs
CREATE POLICY "super_admin/admin can view all audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  )
);
-- Create new policy: Leads can view audit logs for their department users
-- Uses lead_departments if available, otherwise uses the lead's own department
CREATE POLICY "Leads can view their department audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND (p.department IS NOT NULL OR (p.lead_departments IS NOT NULL AND (array_length(p.lead_departments, 1) IS NULL OR array_length(p.lead_departments, 1) > 0)))
    AND (
      -- Logs where the user performing the action is in lead's department
      EXISTS (
        SELECT 1 FROM profiles p2
        WHERE p2.id = audit_logs.user_id
        AND (
          (p.lead_departments IS NOT NULL AND (array_length(p.lead_departments, 1) IS NOT NULL AND array_length(p.lead_departments, 1) > 0) AND p2.department = ANY(p.lead_departments))
          OR
          ((p.lead_departments IS NULL OR array_length(p.lead_departments, 1) IS NULL OR array_length(p.lead_departments, 1) = 0) AND p.department IS NOT NULL AND p2.department = p.department)
        )
      )
      OR
      -- Logs where the target user (if any) is in lead's department
      (
        audit_logs.entity_id IS NOT NULL
        AND audit_logs.entity_type IN ('profile', 'user', 'pending_user')
        AND EXISTS (
          SELECT 1 FROM profiles p3
          WHERE p3.id = audit_logs.entity_id
          AND (
            (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0 AND p3.department = ANY(p.lead_departments))
            OR
            (p.lead_departments IS NULL OR array_length(p.lead_departments, 1) = 0 AND p3.department = p.department)
          )
        )
      )
      OR
      -- Logs for tasks in lead's departments
      (
        audit_logs.entity_type = 'task'
        AND audit_logs.entity_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.id = audit_logs.entity_id
          AND (
            (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0 AND t.department = ANY(p.lead_departments))
            OR
            (p.lead_departments IS NULL OR array_length(p.lead_departments, 1) = 0 AND t.department = p.department)
          )
        )
      )
      OR
      -- Logs for devices assigned to users in lead's departments
      (
        audit_logs.entity_type IN ('device', 'device_assignment')
        AND audit_logs.entity_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM device_assignments da
          JOIN profiles p4 ON p4.id = da.assigned_to
          WHERE da.device_id = audit_logs.entity_id
          AND da.is_current = true
          AND (
            (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0 AND p4.department = ANY(p.lead_departments))
            OR
            (p.lead_departments IS NULL OR array_length(p.lead_departments, 1) = 0 AND p4.department = p.department)
          )
        )
      )
      OR
      -- Logs for assets assigned to users or departments in lead's departments
      (
        audit_logs.entity_type IN ('asset', 'asset_assignment')
        AND audit_logs.entity_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM asset_assignments aa
          LEFT JOIN profiles p5 ON p5.id = aa.assigned_to
          WHERE aa.asset_id = audit_logs.entity_id
          AND aa.is_current = true
          AND (
            (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0 AND (
              (aa.assigned_to IS NOT NULL AND p5.department = ANY(p.lead_departments))
              OR
              (aa.department IS NOT NULL AND aa.department = ANY(p.lead_departments))
            ))
            OR
            (p.lead_departments IS NULL OR array_length(p.lead_departments, 1) = 0 AND (
              (aa.assigned_to IS NOT NULL AND p5.department = p.department)
              OR
              (aa.department IS NOT NULL AND aa.department = p.department)
            ))
          )
        )
      )
      OR
      -- Logs for documentation created by users in lead's departments
      (
        audit_logs.entity_type = 'documentation'
        AND audit_logs.entity_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM user_documentation ud
          JOIN profiles p6 ON p6.id = ud.user_id
          WHERE ud.id = audit_logs.entity_id
          AND (
            (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0 AND p6.department = ANY(p.lead_departments))
            OR
            (p.lead_departments IS NULL OR array_length(p.lead_departments, 1) = 0 AND p6.department = p.department)
          )
        )
      )
    )
  )
);
-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
