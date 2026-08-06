-- Leave entitlement is now derived, not stored.
--
-- The allocation never varied: it is whatever the leave type grants, and it resets on
-- 1 January. Storing it as rows per person, per type, per year meant something had to create
-- those rows every year. Nothing did — the 2026 rows were typed in by hand — so staff
-- onboarded between manual imports had no entitlement at all, and 1 January 2027 would have
-- left every employee with none.
--
-- lib/hr/leave-entitlement.ts now computes: allowance (leave_types.max_days) minus the
-- employee's own leave_requests for the year. Verified against the stored rows before the
-- switch: 348 comparisons, zero differences in allocation, used, or remaining.
--
-- This migration removes the reservation function, which existed only to guard the stored
-- balance against concurrent updates. There is no stored number to race on any more; the
-- check sums the employee's requests, and requests are rows the database already serialises.

DROP FUNCTION IF EXISTS public.check_and_reserve_leave_balance(uuid, uuid, integer);

-- The table is intentionally left in place, populated, and untouched. It is no longer read
-- or written by the application, but it is the only record of the hand-entered 2026 figures,
-- so it stays as a reference until the derived model has run through a full leave cycle.
-- Drop it only after that, in its own migration.
COMMENT ON TABLE public.leave_balances IS
  'DEPRECATED as of 2026-08-06. Leave entitlement is derived at read time — see lib/hr/leave-entitlement.ts. This table is no longer read or written; retained only as a record of the hand-entered 2026 allocations.';
