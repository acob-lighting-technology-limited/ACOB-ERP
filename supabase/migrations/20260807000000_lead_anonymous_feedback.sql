-- Anonymous upward feedback: staff → the lead of their OWN department.
--
-- Design notes (see /api/feedback for the enforcement side):
--   * A lead-directed row is TRULY anonymous: user_id stays NULL, so nothing in
--     the database links the row to its author (not even for service-role
--     readers). The trade-off is that submitters cannot list/edit/delete it.
--   * target_lead_id names the lead the feedback is about. target_department is
--     a denormalized snapshot of that lead's department for reporting.
--   * Eligibility ("only my own lead") is enforced in the API route, which
--     resolves the submitter's department server-side. The client never gets to
--     choose an arbitrary lead id.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS target_lead_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS target_department TEXT;

COMMENT ON COLUMN public.feedback.target_lead_id IS
  'When set, this feedback is about that department lead. Such rows always have user_id = NULL (true anonymity) and are visible to HR/super-admin only — never to the named lead.';
COMMENT ON COLUMN public.feedback.target_department IS
  'Snapshot of the target lead''s canonical department at submission time.';

CREATE INDEX IF NOT EXISTS feedback_target_lead_id_idx
  ON public.feedback (target_lead_id)
  WHERE target_lead_id IS NOT NULL;

-- Harden the admin SELECT policy: an admin who is themselves the named lead
-- must never read feedback written about them.
DROP POLICY IF EXISTS "Admins can view all feedback" ON public.feedback;

CREATE POLICY "Admins can view all feedback" ON public.feedback
  FOR SELECT
  USING (
    (target_lead_id IS NULL OR target_lead_id <> auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role IN ('admin', 'super_admin'))
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Timing correlation defence
-- ─────────────────────────────────────────────────────────────────────────────
-- A precise created_at can be joined against platform request logs ("who called
-- POST /api/feedback at 14:32:07") to unmask the author. Lead-directed rows are
-- therefore stamped to the start of the WAT calendar day — HR loses nothing they
-- use (the admin table already renders date-only) and the correlation window
-- widens from one second to one day.
--
-- Enforced in the database rather than only in the route so that any future
-- insert path inherits it. BEFORE INSERT also means the audit trigger below
-- observes the already-coarsened values.

CREATE OR REPLACE FUNCTION public.coarsen_lead_feedback_timestamps() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.target_lead_id IS NOT NULL THEN
    NEW.created_at := (date_trunc('day', (now() AT TIME ZONE 'Africa/Lagos')) AT TIME ZONE 'Africa/Lagos');
    NEW.updated_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.coarsen_lead_feedback_timestamps() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.coarsen_lead_feedback_timestamps() TO authenticated, service_role;

DROP TRIGGER IF EXISTS coarsen_lead_feedback_timestamps_before_insert ON public.feedback;

CREATE TRIGGER coarsen_lead_feedback_timestamps_before_insert
  BEFORE INSERT ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.coarsen_lead_feedback_timestamps();

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit trigger: do not log the CREATION of lead-directed feedback
-- ─────────────────────────────────────────────────────────────────────────────
-- audit_log_changes() writes auth.uid() plus the full NEW row into audit_logs.
-- For lead-directed feedback that is a direct deanonymisation: whenever the
-- insert runs on the caller's session rather than the service-role client (the
-- documented fallback in getServiceRoleClientOrFallback when the service key is
-- absent), auth.uid() is the submitter and new_values carries their words.
--
-- Splitting the trigger keeps full audit coverage for UPDATE/DELETE — those are
-- HR actions on an existing report, where accountability is what we want — while
-- creating an anonymous report leaves no actor-stamped trace at all.

DROP TRIGGER IF EXISTS audit_feedback_changes ON public.feedback;

CREATE TRIGGER audit_feedback_changes
  AFTER UPDATE OR DELETE ON public.feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_changes();

DROP TRIGGER IF EXISTS audit_feedback_insert ON public.feedback;

CREATE TRIGGER audit_feedback_insert
  AFTER INSERT ON public.feedback
  FOR EACH ROW
  WHEN (NEW.target_lead_id IS NULL)
  EXECUTE FUNCTION public.audit_log_changes();
