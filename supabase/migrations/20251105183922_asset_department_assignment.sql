-- ============================================
-- Asset Department Assignment Support
-- ============================================

-- Add assignment_type column to assets table
ALTER TABLE assets
ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'individual' CHECK (assignment_type IN ('individual', 'department'));
-- Add department column to assets table for department assignments
ALTER TABLE assets
ADD COLUMN IF NOT EXISTS department TEXT;
-- Add department column to asset_assignments table for tracking department assignments
ALTER TABLE asset_assignments
ADD COLUMN IF NOT EXISTS department TEXT;
-- Update unique constraint to allow department assignments
DROP INDEX IF EXISTS unique_current_asset_assignment;
-- Create new unique constraint that allows either individual or department assignment
CREATE UNIQUE INDEX IF NOT EXISTS unique_current_asset_assignment 
ON asset_assignments(asset_id) 
WHERE is_current = true AND assigned_to IS NOT NULL;
-- Create index for department assignments
CREATE INDEX IF NOT EXISTS idx_asset_assignments_department ON asset_assignments(department);
CREATE INDEX IF NOT EXISTS idx_assets_department ON assets(department);
CREATE INDEX IF NOT EXISTS idx_assets_assignment_type ON assets(assignment_type);
-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
