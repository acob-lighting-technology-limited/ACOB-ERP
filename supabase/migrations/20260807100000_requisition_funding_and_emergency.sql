-- Migration: Requisition project funding categories + Emergency (expedited) approval route
--
-- 1. `requisition_funding_categories` — managed lookup of project funding sources
--    (Citibank, AfDB, internal company funds, etc.) that a requisition is drawn against.
-- 2. Requisition columns for the funding category and for the expedited
--    "Emergency Requisition" route that bypasses the middle approval tiers.

-- ─────────────────────────────────────────────────────────────────────────────
-- Funding categories lookup
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.requisition_funding_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requisition_funding_categories_active
  ON public.requisition_funding_categories (is_active, sort_order);

ALTER TABLE public.requisition_funding_categories ENABLE ROW LEVEL SECURITY;

-- Reference data: any signed-in staff member may read it (needed to fill the form).
DROP POLICY IF EXISTS "authenticated_read_funding_categories" ON public.requisition_funding_categories;
CREATE POLICY "authenticated_read_funding_categories"
  ON public.requisition_funding_categories FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Only admin-like roles may add/edit funders.
DROP POLICY IF EXISTS "admins_manage_funding_categories" ON public.requisition_funding_categories;
CREATE POLICY "admins_manage_funding_categories"
  ON public.requisition_funding_categories FOR ALL
  TO authenticated
  USING (public.has_role('admin'))
  WITH CHECK (public.has_role('admin'));

CREATE OR REPLACE FUNCTION public.set_requisition_funding_categories_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_requisition_funding_categories_updated_at() FROM anon, PUBLIC;

DROP TRIGGER IF EXISTS trg_requisition_funding_categories_updated_at ON public.requisition_funding_categories;
CREATE TRIGGER trg_requisition_funding_categories_updated_at
BEFORE UPDATE ON public.requisition_funding_categories
FOR EACH ROW EXECUTE FUNCTION public.set_requisition_funding_categories_updated_at();

-- Starting set. Additional funders are added from Admin → Finance → Requisitions.
INSERT INTO public.requisition_funding_categories (code, name, description, sort_order)
VALUES
  ('internal', 'Internal / Company Funds', 'Funded from ACOB operating capital', 10),
  ('citibank', 'Citibank', 'Citibank-funded project line', 20),
  ('afdb', 'AfDB', 'African Development Bank funded project line', 30),
  ('other', 'Other (state in purpose)', 'Funding source not yet listed — state it in the purpose field', 900)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Requisition columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.requisitions
  ADD COLUMN IF NOT EXISTS funding_category_id uuid
    REFERENCES public.requisition_funding_categories(id) ON DELETE SET NULL,
  -- Denormalised so a printed/archived form keeps the funder label it was raised under
  -- even if the category is later renamed.
  ADD COLUMN IF NOT EXISTS funding_category_name text,
  ADD COLUMN IF NOT EXISTS is_emergency boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS emergency_justification text,
  -- Stage codes skipped by the expedited route, kept for the audit trail.
  ADD COLUMN IF NOT EXISTS bypassed_stages text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS idx_requisitions_funding_category
  ON public.requisitions (funding_category_id);

CREATE INDEX IF NOT EXISTS idx_requisitions_is_emergency
  ON public.requisitions (is_emergency)
  WHERE is_emergency;

-- An emergency requisition must carry a written justification.
ALTER TABLE public.requisitions
  DROP CONSTRAINT IF EXISTS requisitions_emergency_justification_required;
ALTER TABLE public.requisitions
  ADD CONSTRAINT requisitions_emergency_justification_required
  CHECK (
    NOT is_emergency
    OR (emergency_justification IS NOT NULL AND length(btrim(emergency_justification)) >= 20)
  );
