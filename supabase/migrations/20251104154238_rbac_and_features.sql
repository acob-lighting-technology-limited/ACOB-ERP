-- ============================================
-- RBAC System - Role-Based Access Control
-- ============================================

-- Create enum for user roles
-- Role Hierarchy (from highest to lowest):
-- 1. super_admin - Full system access, can assign all roles including admin
-- 2. admin - HR functions, cannot assign roles to leads or themselves
-- 3. lead - Department leads with limited management access
-- 4. staff - Regular employees
-- 5. visitor - Read-only guest access
CREATE TYPE user_role AS ENUM ('visitor', 'staff', 'lead', 'admin', 'super_admin');
-- Update profiles table to include role and department lead info
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS role user_role DEFAULT 'staff',
ADD COLUMN IF NOT EXISTS is_department_lead BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS lead_departments TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS job_description TEXT,
ADD COLUMN IF NOT EXISTS job_description_updated_at TIMESTAMPTZ;
-- ============================================
-- Device Management System
-- ============================================

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  device_model TEXT,
  serial_number TEXT UNIQUE,
  purchase_date DATE,
  notes TEXT,
  status TEXT DEFAULT 'available', -- available, assigned, maintenance, retired
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);
-- Device assignments table (tracks history)
CREATE TABLE IF NOT EXISTS device_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES auth.users(id),
  assigned_from UUID REFERENCES auth.users(id), -- previous user (null if new assignment)
  assigned_by UUID REFERENCES auth.users(id), -- admin who made the assignment
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  handed_over_at TIMESTAMPTZ, -- when device was returned/transferred
  assignment_notes TEXT,
  handover_notes TEXT,
  is_current BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- Task Management System
-- ============================================

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'medium', -- low, medium, high, urgent
  status TEXT DEFAULT 'pending', -- pending, in_progress, completed, cancelled
  assigned_to UUID REFERENCES auth.users(id),
  assigned_by UUID REFERENCES auth.users(id),
  department TEXT,
  due_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  progress INTEGER DEFAULT 0, -- 0-100
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Task comments/updates
CREATE TABLE IF NOT EXISTS task_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  update_type TEXT, -- comment, status_change, progress_update
  content TEXT,
  old_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- Documentation System
-- ============================================

-- User documentation
CREATE TABLE IF NOT EXISTS user_documentation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL, -- Rich text/markdown content
  category TEXT,
  tags TEXT[],
  is_draft BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- Audit Log System
-- ============================================

-- Audit logs for all CRUD operations
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL, -- create, update, delete, assign, etc.
  entity_type TEXT NOT NULL, -- task, device, profile, etc.
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- ============================================
-- Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_device_assignments_device_id ON device_assignments(device_id);
CREATE INDEX IF NOT EXISTS idx_device_assignments_assigned_to ON device_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_device_assignments_is_current ON device_assignments(is_current);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(department);
CREATE INDEX IF NOT EXISTS idx_task_updates_task_id ON task_updates(task_id);
CREATE INDEX IF NOT EXISTS idx_user_documentation_user_id ON user_documentation(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_documentation ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
-- Devices policies
CREATE POLICY "Users can view all devices" ON devices FOR SELECT USING (true);
CREATE POLICY "Only super_admin/admin can create devices" ON devices FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role IN ('super_admin', 'admin'))
  )
);
CREATE POLICY "Only super_admin/admin can update devices" ON devices FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role IN ('super_admin', 'admin'))
  )
);
-- Device assignments policies
CREATE POLICY "Users can view their own device assignments" ON device_assignments FOR SELECT USING (
  assigned_to = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role IN ('super_admin', 'admin', 'lead'))
  )
);
CREATE POLICY "Only super_admin/admin can create device assignments" ON device_assignments FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (profiles.role IN ('super_admin', 'admin'))
  )
);
-- Tasks policies
CREATE POLICY "Users can view their assigned tasks or tasks they created" ON tasks FOR SELECT USING (
  assigned_to = auth.uid() OR
  assigned_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (
      profiles.role IN ('super_admin', 'admin') OR
      (profiles.role = 'lead' AND department = ANY(profiles.lead_departments))
    )
  )
);
CREATE POLICY "Leads/admin/super_admin can create tasks" ON tasks FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin', 'lead')
  )
);
CREATE POLICY "Task assignee or creator can update" ON tasks FOR UPDATE USING (
  assigned_to = auth.uid() OR
  assigned_by = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND (
      profiles.role IN ('super_admin', 'admin') OR
      (profiles.role = 'lead' AND department = ANY(profiles.lead_departments))
    )
  )
);
-- Task updates policies
CREATE POLICY "Users can view task updates for their tasks" ON task_updates FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM tasks
    WHERE tasks.id = task_updates.task_id
    AND (tasks.assigned_to = auth.uid() OR tasks.assigned_by = auth.uid())
  ) OR
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin', 'lead')
  )
);
CREATE POLICY "Users can create task updates" ON task_updates FOR INSERT WITH CHECK (true);
-- Documentation policies
CREATE POLICY "Users can view their own documentation" ON user_documentation FOR SELECT USING (
  user_id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM profiles p1, profiles p2
    WHERE p1.id = auth.uid()
    AND p2.id = user_documentation.user_id
    AND (
      p1.role IN ('super_admin', 'admin') OR
      (p1.role = 'lead' AND p2.department = ANY(p1.lead_departments))
    )
  )
);
CREATE POLICY "Users can create their own documentation" ON user_documentation FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their own documentation" ON user_documentation FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "Users can delete their own documentation" ON user_documentation FOR DELETE USING (user_id = auth.uid());
-- Audit logs policies
CREATE POLICY "super_admin/admin can view all audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('super_admin', 'admin')
  )
);
CREATE POLICY "Leads can view their department audit logs" ON audit_logs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role = 'lead'
    AND EXISTS (
      SELECT 1 FROM profiles p2
      WHERE p2.id = audit_logs.user_id
      AND p2.department = ANY(p.lead_departments)
    )
  )
);
-- ============================================
-- Functions for Audit Logging
-- ============================================

-- Function to log audit entries
CREATE OR REPLACE FUNCTION log_audit(
  p_action TEXT,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  audit_id UUID;
BEGIN
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_old_values, p_new_values)
  RETURNING id INTO audit_id;

  RETURN audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- ============================================
-- Triggers for Updated_at Timestamps
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER update_devices_updated_at BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_documentation_updated_at BEFORE UPDATE ON user_documentation
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================
-- Initial Data / Grants
-- ============================================

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
