-- Migration: Add employment fields to pending_users
-- Created: 2026-07-03

ALTER TABLE public.pending_users
    ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract')),
    ADD COLUMN IF NOT EXISTS contract_category_id uuid REFERENCES public.contract_categories(id) ON DELETE SET NULL;
