-- Migration: Create Requisition System table, sequence, indexes, RLS, and storage bucket

CREATE SEQUENCE IF NOT EXISTS public.requisition_number_seq START WITH 1001;

CREATE TABLE IF NOT EXISTS public.requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_number text NOT NULL UNIQUE DEFAULT ('REQ-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.requisition_number_seq')::text, 5, '0')),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  department text NOT NULL,
  project_name text NOT NULL,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  amount_in_words text NOT NULL,
  purpose text NOT NULL,
  beneficiary_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_stage_code text NOT NULL DEFAULT 'pending_reviewed_by',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  
  -- Stage 1: Reviewed By (Admin & HR Lead)
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewed_comments text,

  -- Stage 2: Authorized By (Corporate Services Lead / HCS)
  authorized_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  authorized_at timestamptz,
  authorized_comments text,

  -- Stage 3: Verified By (Accounts Lead)
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  verified_comments text,

  -- Stage 4: Approved By (Executive Management Lead / MD)
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_comments text,

  rejection_reason text,
  rejected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  rejected_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_requisitions_user_id ON public.requisitions (user_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON public.requisitions (status);
CREATE INDEX IF NOT EXISTS idx_requisitions_stage ON public.requisitions (current_stage_code);
CREATE INDEX IF NOT EXISTS idx_requisitions_department ON public.requisitions (department);

-- Enable RLS
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "users_select_requisitions"
  ON public.requisitions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "users_insert_own_requisitions"
  ON public.requisitions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_update_requisitions"
  ON public.requisitions FOR UPDATE
  TO authenticated
  USING (true);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.set_requisitions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_requisitions_updated_at ON public.requisitions;
CREATE TRIGGER trg_requisitions_updated_at BEFORE UPDATE ON public.requisitions
FOR EACH ROW EXECUTE FUNCTION public.set_requisitions_updated_at();

-- Storage bucket for requisition documents / receipts
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'requisition_documents',
  'requisition_documents',
  true, -- Public read for rendered documents/preview
  10485760, -- 10MB limit
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload requisition documents"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'requisition_documents');

CREATE POLICY "Users can view requisition documents"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'requisition_documents');
