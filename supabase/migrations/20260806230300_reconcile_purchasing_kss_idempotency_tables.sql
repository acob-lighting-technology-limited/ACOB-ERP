-- Second reconciliation batch: tables whose migrations prod records as applied but
-- which do not exist there (same stamped-not-executed drift as 20260806230000).
--   20260416121000_create_purchasing_core_tables  (suppliers, purchase_orders, items)
--   20260403150002_create_kss_results
--   20260403120000_create_idempotency_keys
--
-- DEVIATION FROM THE ORIGINAL: 20260416121000 creates its three tables with NO
-- row level security. On this project ALTER DEFAULT PRIVILEGES grants anon
-- arwdDxtm on every new table in public (verified via pg_default_acl), so applying
-- it verbatim would publish supplier and purchase-order data as anon-readable AND
-- anon-writable over PostgREST — the same defect as attendance_exempt_periods in
-- the July VAPT. RLS + admin-scoped policies + an anon revoke are therefore added
-- here. The purchasing API routes are all gated on scope.isAdminLike and read
-- through getServiceRoleClientOrFallback, so admin-only policies match the app.
--
-- NOTE for any future table added to this schema: RLS is NOT optional here. A bare
-- CREATE TABLE in public is world-writable via the anon key by default.

-- ── purchasing core ──────────────────────────────────────────────────
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  email text,
  phone text,
  address text,
  contact_person text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  order_date date not null default current_date,
  expected_date date,
  total_amount numeric(14, 2) not null default 0,
  currency text not null default 'NGN',
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'received', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_name text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_name_idx on public.suppliers(name);
create index if not exists purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index if not exists purchase_orders_status_idx on public.purchase_orders(status);
create index if not exists purchase_order_items_purchase_order_id_idx on public.purchase_order_items(purchase_order_id);

do $$
declare
  t text;
begin
  foreach t in array array['suppliers', 'purchase_orders', 'purchase_order_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_manage', t);
    execute format($p$
      create policy %I on public.%I for all to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and lower(coalesce(p.role::text, '')) in ('developer', 'super_admin', 'admin')
        )
      )
    $p$, t || '_admin_manage', t);
  end loop;
end
$$;

-- ── kss_results ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kss_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES public.kss_weekly_roster(id) ON DELETE CASCADE,
  presenter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  evaluator_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  score numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  feedback text,
  meeting_week integer NOT NULL,
  meeting_year integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(roster_id, evaluator_id)
);

ALTER TABLE public.kss_results ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kss_results FROM anon;

DROP POLICY IF EXISTS "kss_results_insert" ON public.kss_results;
CREATE POLICY "kss_results_insert" ON public.kss_results
  FOR INSERT TO authenticated
  WITH CHECK (evaluator_id = auth.uid());

DROP POLICY IF EXISTS "kss_results_select" ON public.kss_results;
CREATE POLICY "kss_results_select" ON public.kss_results
  FOR SELECT TO authenticated
  USING (
    presenter_id = auth.uid()
    OR evaluator_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND lower(trim(p.role::text)) IN ('developer', 'super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "kss_results_update" ON public.kss_results;
CREATE POLICY "kss_results_update" ON public.kss_results
  FOR UPDATE TO authenticated
  USING (evaluator_id = auth.uid());

-- ── idempotency_keys ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key TEXT PRIMARY KEY,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON public.idempotency_keys (created_at);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.idempotency_keys FROM anon, authenticated;

DROP POLICY IF EXISTS "service role can manage idempotency keys" ON public.idempotency_keys;
CREATE POLICY "service role can manage idempotency keys"
ON public.idempotency_keys
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
