-- ============================================
-- Enhanced Task Assignment System
-- ============================================

-- Add assignment_type column to tasks table
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'individual' CHECK (assignment_type IN ('individual', 'multiple', 'department'));
-- Create task_assignments table for multiple user assignments
CREATE TABLE IF NOT EXISTS task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);
-- Create task_user_completion table to track individual completions for multiple-user tasks
CREATE TABLE IF NOT EXISTS task_user_completion (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);
-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_task_assignments_task_id ON task_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignments_user_id ON task_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_user_completion_task_id ON task_user_completion(task_id);
CREATE INDEX IF NOT EXISTS idx_task_user_completion_user_id ON task_user_completion(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignment_type ON tasks(assignment_type);
-- Enable RLS
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_user_completion ENABLE ROW LEVEL SECURITY;
-- RLS Policies for task_assignments
CREATE POLICY "Users can view their own task assignments"
  ON task_assignments FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all task assignments"
  ON task_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
CREATE POLICY "Department leads can view assignments for their departments"
  ON task_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN profiles p ON t.department = ANY(p.lead_departments)
      WHERE t.id = task_assignments.task_id
      AND p.id = auth.uid()
    )
  );
CREATE POLICY "Admins can manage task assignments"
  ON task_assignments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin', 'lead')
    )
  );
-- RLS Policies for task_user_completion
CREATE POLICY "Users can view their own task completions"
  ON task_user_completion FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can mark their own tasks as complete"
  ON task_user_completion FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all task completions"
  ON task_user_completion FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role IN ('admin', 'super_admin')
    )
  );
CREATE POLICY "Department leads can view completions for their department tasks"
  ON task_user_completion FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      JOIN profiles p ON t.department = ANY(p.lead_departments)
      WHERE t.id = task_user_completion.task_id
      AND p.id = auth.uid()
    )
  );
-- Function to update task status based on completions (for multiple-user tasks)
CREATE OR REPLACE FUNCTION update_task_status_from_completions()
RETURNS TRIGGER AS $$
DECLARE
  task_record tasks%ROWTYPE;
  total_assignments INTEGER;
  completed_count INTEGER;
BEGIN
  -- Get task details
  SELECT * INTO task_record FROM tasks WHERE id = NEW.task_id;
  
  -- Only process multiple-user tasks
  IF task_record.assignment_type = 'multiple' THEN
    -- Count total assignments
    SELECT COUNT(*) INTO total_assignments
    FROM task_assignments
    WHERE task_id = NEW.task_id;
    
    -- Count completed assignments
    SELECT COUNT(*) INTO completed_count
    FROM task_user_completion
    WHERE task_id = NEW.task_id;
    
    -- Update task status based on completion
    IF completed_count = total_assignments AND total_assignments > 0 THEN
      UPDATE tasks
      SET status = 'completed', completed_at = NOW()
      WHERE id = NEW.task_id;
    ELSIF completed_count > 0 THEN
      UPDATE tasks
      SET status = 'in_progress'
      WHERE id = NEW.task_id AND status = 'pending';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger to update task status when user completes
CREATE TRIGGER trigger_update_task_status_on_completion
AFTER INSERT ON task_user_completion
FOR EACH ROW
EXECUTE FUNCTION update_task_status_from_completions();
-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
