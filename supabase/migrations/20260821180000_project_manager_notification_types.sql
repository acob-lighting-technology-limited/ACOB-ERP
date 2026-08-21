-- Notification types for the project-manager reminders in the Project
-- Management Dashboard spec: deadlines approaching, submitted work waiting on
-- a decision, approved work still unrated, and projects slipping behind.
--
-- The constraint is replaced wholesale rather than appended to, so the full
-- existing list is restated here.

ALTER TABLE public.notifications
DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
ADD CONSTRAINT notifications_type_check
CHECK (
  type = ANY (
    ARRAY[
      -- Existing legacy/system types
      'token_generated',
      'token_cancelled',
      'task_completed',
      'task_failed',
      'customer_added',
      'customer_updated',
      'meter_status_change',
      'meter_added',
      'activity_reminder',
      'crm_contact_added',
      'opportunity_won',
      'opportunity_lost',
      'system_alert',
      'asset_assigned',
      'asset_transfer_outgoing',
      'asset_transfer_incoming',
      'asset_returned',
      'asset_status_alert',
      'asset_status_fixed',
      'system_restored',
      -- App notification types
      'task_assigned',
      'task_updated',
      'mention',
      'feedback',
      'approval_request',
      'approval_granted',
      'approval_rejected',
      'announcement',
      'system',
      -- Project/task governance reminders
      'task_due_soon',
      'task_awaiting_review',
      'task_needs_rating',
      'project_delayed',
      -- Already emitted by the task status route but never in this list, so
      -- every one of these inserts failed the CHECK and was swallowed by the
      -- caller's try/catch: the "unable to complete" alert has never reached
      -- the lead who assigned the work.
      'task_blocked'
    ]::text[]
  )
);

-- The reminder job looks up "have we already told this person about this
-- task/project recently?" on every run.
CREATE INDEX IF NOT EXISTS idx_notifications_entity_recent
  ON public.notifications (entity_id, type, created_at DESC);

NOTIFY pgrst, 'reload schema';
