-- ============================================
-- Lead Role Permissions Fix
-- ============================================
-- This migration updates RLS policies to ensure leads can only see:
-- 1. Tasks related to their department
-- 2. Documentation related to their department only
-- 3. Staff in their lead departments only
-- 4. Devices and assets for their department only
-- 5. Audit logs only for their department and people
-- Leads CANNOT see: Job descriptions, Feedback

-- ============================================
-- Update Profiles Policies (Staff Management)
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
-- Create new policy: Leads can only see staff in their lead departments
CREATE POLICY "Leads can view staff in their departments" ON profiles FOR SELECT USING (
  -- Users can always see their own profile
  id = auth.uid() OR
  -- Super admin and admin can see all profiles
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can only see staff in their lead departments
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND profiles.department = ANY(p.lead_departments)
  )
);
-- ============================================
-- Update Devices Policies
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view all devices" ON devices;
-- Create new policy: Leads can only see devices for their department
CREATE POLICY "Users can view devices based on role" ON devices FOR SELECT USING (
  -- Super admin and admin can see all devices
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can only see devices assigned to their departments
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN device_assignments da ON da.device_id = devices.id
    JOIN profiles assigned_user ON assigned_user.id = da.assigned_to
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND da.is_current = true
    AND assigned_user.department = ANY(p.lead_departments)
  ) OR
  -- Staff can see their own assigned devices
  EXISTS (
    SELECT 1 FROM device_assignments
    WHERE device_assignments.device_id = devices.id
    AND device_assignments.assigned_to = auth.uid()
    AND device_assignments.is_current = true
  )
);
-- ============================================
-- Update Device Assignments Policies
-- ============================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own device assignments" ON device_assignments;
-- Create new policy: Leads can see assignments for their department staff
CREATE POLICY "Users can view device assignments based on role" ON device_assignments FOR SELECT USING (
  -- Users can see their own assignments
  assigned_to = auth.uid() OR
  -- Super admin and admin can see all assignments
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can see assignments for staff in their departments
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN profiles assigned_user ON assigned_user.id = device_assignments.assigned_to
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND assigned_user.department = ANY(p.lead_departments)
  )
);
-- ============================================
-- Update Assets Policies
-- ============================================

-- Drop existing policies if they exist
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'assets' AND policyname = 'Users can view all assets') THEN
    DROP POLICY "Users can view all assets" ON assets;
  END IF;
END $$;
-- Create new policy: Leads can only see assets for their department
CREATE POLICY "Users can view assets based on role" ON assets FOR SELECT USING (
  -- Super admin and admin can see all assets
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can only see assets assigned to their departments
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN asset_assignments aa ON aa.asset_id = assets.id
    LEFT JOIN profiles assigned_user ON assigned_user.id = aa.assigned_to
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND aa.is_current = true
    AND (
      -- Individual assignment: check if assigned user is in lead's department
      (aa.assigned_to IS NOT NULL AND assigned_user.department = ANY(p.lead_departments))
      OR
      -- Department assignment: check if department matches
      (aa.department IS NOT NULL AND aa.department = ANY(p.lead_departments))
    )
  ) OR
  -- Staff can see their own assigned assets (handled by asset_assignments policy)
  EXISTS (
    SELECT 1 FROM asset_assignments
    WHERE asset_assignments.asset_id = assets.id
    AND asset_assignments.assigned_to = auth.uid()
    AND asset_assignments.is_current = true
  )
);
-- ============================================
-- Update Asset Assignments Policies
-- ============================================

-- Drop existing policies if they exist
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'asset_assignments' AND policyname = 'Users can view their own asset assignments') THEN
    DROP POLICY "Users can view their own asset assignments" ON asset_assignments;
  END IF;
END $$;
-- Create new policy: Leads can see assignments for their department staff
CREATE POLICY "Users can view asset assignments based on role" ON asset_assignments FOR SELECT USING (
  -- Users can see their own assignments
  assigned_to = auth.uid() OR
  -- Super admin and admin can see all assignments
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can see assignments for staff in their departments
  EXISTS (
    SELECT 1 FROM profiles p
    LEFT JOIN profiles assigned_user ON assigned_user.id = asset_assignments.assigned_to
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND (
      -- Individual assignment: check if assigned user is in lead's department
      (assigned_to IS NOT NULL AND assigned_user.department = ANY(p.lead_departments))
      OR
      -- Department assignment: check if department matches
      (department IS NOT NULL AND department = ANY(p.lead_departments))
    )
  )
);
-- ============================================
-- Update Task Updates Policies
-- ============================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view task updates for their tasks" ON task_updates;
-- Create new policy: Leads can see updates for department tasks
CREATE POLICY "Users can view task updates based on role" ON task_updates FOR SELECT USING (
  -- Users can see updates for their own tasks
  EXISTS (
    SELECT 1 FROM tasks
    WHERE tasks.id = task_updates.task_id
    AND (tasks.assigned_to = auth.uid() OR tasks.assigned_by = auth.uid())
  ) OR
  -- Super admin and admin can see all updates
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can see updates for tasks in their departments
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN tasks t ON t.id = task_updates.task_id
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND t.department = ANY(p.lead_departments)
  )
);
-- ============================================
-- Ensure Feedback Table Has RLS (if not already enabled)
-- ============================================

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view all feedback" ON feedback;
DROP POLICY IF EXISTS "Users can view their own feedback" ON feedback;
DROP POLICY IF EXISTS "Only admins can view feedback" ON feedback;
-- Create policy: Super admin and admin can view all feedback, leads can view their department feedback
CREATE POLICY "Admins and leads can view feedback" ON feedback FOR SELECT USING (
  -- Super admin and admin can see all feedback
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  ) OR
  -- Leads can see feedback from their department users
  EXISTS (
    SELECT 1 FROM profiles p
    JOIN profiles feedback_user ON feedback_user.id = feedback.user_id
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND feedback_user.department = ANY(p.lead_departments)
  ) OR
  -- Users can see their own feedback
  user_id = auth.uid()
);
-- Users can still create their own feedback
CREATE POLICY "Users can create their own feedback" ON feedback FOR INSERT WITH CHECK (user_id = auth.uid());
-- Users can update their own feedback
CREATE POLICY "Users can update their own feedback" ON feedback FOR UPDATE USING (user_id = auth.uid());
-- ============================================
-- Update Audit Logs Policies
-- ============================================

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
CREATE POLICY "Leads can view their department audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND (
      -- Use lead_departments if available, otherwise use the lead's own department
      (p.lead_departments IS NOT NULL AND array_length(p.lead_departments, 1) > 0)
      OR
      (p.department IS NOT NULL)
    )
    AND (
      -- Logs where the user performing the action is in lead's department
      EXISTS (
        SELECT 1 FROM profiles p2
        WHERE p2.id = audit_logs.user_id
        AND p2.department = ANY(p.lead_departments)
      )
      OR
      -- Logs where the target user (if any) is in lead's department
      -- This checks entity_id when it's a user profile
      (
        audit_logs.entity_id IS NOT NULL
        AND audit_logs.entity_type IN ('profile', 'user', 'pending_user')
        AND EXISTS (
          SELECT 1 FROM profiles p3
          WHERE p3.id = audit_logs.entity_id
          AND p3.department = ANY(p.lead_departments)
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
          AND t.department = ANY(p.lead_departments)
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
          AND p4.department = ANY(p.lead_departments)
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
            (aa.assigned_to IS NOT NULL AND p5.department = ANY(p.lead_departments))
            OR
            (aa.department IS NOT NULL AND aa.department = ANY(p.lead_departments))
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
          AND p6.department = ANY(p.lead_departments)
        )
      )
    )
  )
);
-- ============================================
-- Ensure Profiles Table Has RLS (if not already enabled)
-- ============================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
