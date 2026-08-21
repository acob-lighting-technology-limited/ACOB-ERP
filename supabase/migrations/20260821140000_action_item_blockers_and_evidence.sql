-- Hindrance reporting on the Action Tracker.
--
-- An action point could only ever be "not done" — the tracker carried no record
-- of *why*, so the same item rolled over week after week with no accountability
-- trail. This adds a free-text hindrance note to every action item (weekly action
-- points and management directives alike — the tracker is one accountability
-- surface) plus optional supporting evidence: photos, video or a document.
--
-- Evidence is deliberately optional. Most hindrances are explained in a sentence;
-- the attachment exists for the cases where a picture settles the question.
--
-- Storage follows help_desk_attachments (20260807150000), the established
-- per-record file pattern in this codebase: a private bucket, a metadata table
-- with its own RLS, and signed URLs minted server-side.

ALTER TABLE public.action_items
  ADD COLUMN IF NOT EXISTS blocker_note text,
  ADD COLUMN IF NOT EXISTS blocker_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS blocker_reported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.action_items.blocker_note IS
  'What is preventing completion, as reported by the department lead or admin. Null when nothing has been reported.';
COMMENT ON COLUMN public.action_items.blocker_reported_at IS 'When the hindrance note was last recorded or revised.';
COMMENT ON COLUMN public.action_items.blocker_reported_by IS 'Who recorded the hindrance note.';

-- ---------------------------------------------------------------------------
-- Supporting evidence
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('action_item_evidence', 'action_item_evidence', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.action_item_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_item_id uuid NOT NULL REFERENCES public.action_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  caption text,
  uploaded_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.action_item_evidence IS
  'Optional photo / video / document evidence supporting an action item hindrance note. Visible to anyone who can already see the tracker.';

CREATE INDEX IF NOT EXISTS action_item_evidence_item_idx ON public.action_item_evidence (action_item_id);

ALTER TABLE public.action_item_evidence ENABLE ROW LEVEL SECURITY;

-- Reads mirror action_items: 20260808140000 made the tracker an org-wide
-- reporting artefact readable by every authenticated user, and evidence is
-- meaningless without the item it explains.
DROP POLICY IF EXISTS "Authenticated can view action item evidence" ON public.action_item_evidence;
CREATE POLICY "Authenticated can view action item evidence"
  ON public.action_item_evidence FOR SELECT
  TO authenticated
  USING (true);

-- Writes match who may already change the item's status: admin-like, or a lead
-- over the item's department. Uploading is additionally restricted to your own
-- name so an attachment is never attributed to someone else.
DROP POLICY IF EXISTS "Leads and admins can add action item evidence" ON public.action_item_evidence;
CREATE POLICY "Leads and admins can add action item evidence"
  ON public.action_item_evidence FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      LEFT JOIN public.action_items ai ON ai.id = action_item_evidence.action_item_id
      WHERE p.id = (SELECT auth.uid())
        AND (
          lower(trim(p.role::text)) IN ('developer', 'super_admin', 'admin')
          OR (
            p.is_department_lead = true
            AND (
              ai.department = p.department
              OR ai.department = ANY (COALESCE(p.lead_departments, ARRAY[]::text[]))
            )
          )
        )
    )
  );

-- Removal is the uploader's own, or an admin's.
DROP POLICY IF EXISTS "Uploader or admin can remove action item evidence" ON public.action_item_evidence;
CREATE POLICY "Uploader or admin can remove action item evidence"
  ON public.action_item_evidence FOR DELETE
  TO authenticated
  USING (
    uploaded_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = (SELECT auth.uid())
        AND lower(trim(p.role::text)) IN ('developer', 'super_admin', 'admin')
    )
  );

REVOKE ALL ON public.action_item_evidence FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.action_item_evidence TO authenticated;
