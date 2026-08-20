-- Ensure standard review cycles exist with consistent review_type, dates, and naming
-- Q1 2026 (Quarterly: 2026-01-01 to 2026-03-31)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0001-4000-a000-000000000000',
  'Q1 2026 Performance Review',
  '2026-01-01',
  '2026-03-31',
  'quarterly',
  'closed'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;

-- Q2 2026 (Quarterly: 2026-04-01 to 2026-06-30)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0001-4000-a000-000000000001',
  'Q2 2026 Performance Review',
  '2026-04-01',
  '2026-06-30',
  'quarterly',
  'closed'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;

-- Q3 2026 (Quarterly: 2026-07-01 to 2026-09-30) - Active
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0001-4000-a000-000000000002',
  'Q3 2026 Performance Review',
  '2026-07-01',
  '2026-09-30',
  'quarterly',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type,
  status = EXCLUDED.status;

-- Q4 2026 (Quarterly: 2026-10-01 to 2026-12-31)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0001-4000-a000-000000000005',
  'Q4 2026 Performance Review',
  '2026-10-01',
  '2026-12-31',
  'quarterly',
  'planned'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;

-- H1 2026 (Biannual: 2026-01-01 to 2026-06-30)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0002-4000-a000-000000000001',
  'H1 2026 Performance Review',
  '2026-01-01',
  '2026-06-30',
  'biannual',
  'closed'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;

-- H2 2026 (Biannual: 2026-07-01 to 2026-12-31)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0002-4000-a000-000000000002',
  'H2 2026 Performance Review',
  '2026-07-01',
  '2026-12-31',
  'biannual',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;

-- FY 2026 (Annual: 2026-01-01 to 2026-12-31)
INSERT INTO public.review_cycles (id, name, start_date, end_date, review_type, status)
VALUES (
  'aaaaaaaa-0003-4000-a000-000000000001',
  'FY 2026 Annual Performance Review',
  '2026-01-01',
  '2026-12-31',
  'annual',
  'active'
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  review_type = EXCLUDED.review_type;
