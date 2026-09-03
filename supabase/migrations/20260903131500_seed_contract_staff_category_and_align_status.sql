-- Migration: Seed Contract Staff category and link existing field contractors
-- Description: Inserts CTR category into contract_categories and links existing field contractors

-- 1. Insert or update CTR category
INSERT INTO public.contract_categories (name, code, sort_order)
VALUES ('Contract Staff', 'CTR', 1)
ON CONFLICT (code) DO UPDATE
SET name = 'Contract Staff', sort_order = 1;

-- 2. Adjust sort orders of other categories
UPDATE public.contract_categories SET sort_order = 2 WHERE code = 'NYSC';
UPDATE public.contract_categories SET sort_order = 3 WHERE code = 'SIWES';
UPDATE public.contract_categories SET sort_order = 4 WHERE code = 'NEXTGEN';

-- 3. Backfill contract_category_id on the 46 field contractors (leaving their employment_status as 'contract' per constraint rules)
UPDATE public.profiles
SET 
    contract_category_id = (SELECT id FROM public.contract_categories WHERE code = 'CTR' LIMIT 1),
    employment_type = 'contract'
WHERE employee_number LIKE 'ACOB/CTR/%';
