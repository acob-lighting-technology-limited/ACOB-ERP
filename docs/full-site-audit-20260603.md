# Full Website Audit - 2026-06-03

## Result

Fixed the highest-risk department-console spill found during the audit. Added
route loading coverage, repaired broken audit tooling, and restored a missing
admin scope endpoint.

## Changes made

- Locked `/dept/[dept_id]/hr/attendance` daily roster and exceptions tabs to the active department.
- Locked `/dept/[dept_id]/hr/reports/daily-activity` to the active department.
- Locked `/dept/[dept_id]/hr/leave` to dept-specific queue, history, and approve endpoints.
- Locked `/dept/[dept_id]/finance` dashboard stats to the active department ID.
- Locked `/dept/[dept_id]/finance/reports` rows and filters to the active department.
- Locked `/dept/[dept_id]/assets/issues` rows and filters to the active department.
- Locked `/dept/[dept_id]/reports/weekly` department selector to the active department.
- Replaced generic dept loading placeholders with page-shaped skeletons.
- Added missing route `loading.tsx` files across the app.
- Fixed `scripts/ui/audit-reusables.mjs` so page detection works on Windows.
- Restored `/api/admin/scope-mode` for existing admin views.
- Moved fleet page dialogs into `_components`.
- Restored legacy finance payment redirect routes.
- Moved RBAC audit output to `test-results/`.
- Added AGENTS.md standards for dept console scope and route skeletons.

## Critical findings

- Dept wrappers were reusing admin components without passing the active dept into child fetches.
- Attendance summary was scoped, but daily roster and exceptions fetched all records for admin-like users.
- Leave approval used global `/api/hr/leave/*` endpoints from dept pages despite scoped wrappers existing.
- Finance dashboard stats used `/api/payments` without `department_id`.
- Daily activity used admin APIs without a department lock.
- Asset issues used client-side Supabase and could show all visible issues before filtering.
- UI audit was lying on Windows. It reported `totalPages: 0` before the script fix.
- RBAC audit referenced deleted finance routes and wrote to a blocked root report file.
- `/api/admin/scope-mode` was referenced by UI code but missing.

## Skeleton findings

- Earlier dept skeletons were not related enough to their final pages.
- Table routes used one-line generic placeholders.
- Overview loading did not match the dashboard layout.
- Replaced key dept skeletons with canonical page-shaped skeletons.
- Ran `npm run ui:ensure-loading`; it added missing route loading files.
- Generated loading files are acceptable baseline coverage, but need deeper visual tuning later.

## UI and UX findings

- Several immersive KSS and standalone CBT pages intentionally do not use normal page headers.
- Those pages are now explicit UI-audit allowlist entries.
- Fleet dialogs were embedded in the page component.
- Some pages still have ad-hoc empty states:
  - `app/(app)/pms/development-plans/page.tsx`
  - `app/(app)/pms/peer-feedback/page.tsx`
- Some pages still have ad-hoc sections:
  - `app/birthday/page.tsx`
  - `app/kss/page.tsx`
- Some pages still need form field cleanup:
  - `app/(app)/pms/peer-feedback/page.tsx`
  - `app/admin/hr/pms/cbt/question/page.tsx`
  - `app/admin/hr/site-locations/page.tsx`

## Still weak

- Some client admin pages still query Supabase directly.
- `app/admin/hr/departments/view.tsx` still fetches profile data client-side.
- Finance bills and invoices still use client Supabase directly.
- Office locations still use client Supabase directly.
- Asset issues still need a proper server API replacement.
- Several admin pages are marked org-wide but are reused inside dept routes.
- The dept console needs a rule: no admin component reuse without a lock prop.
- Weekly report admin dialog still uses client Supabase for report/action data.

## Backend and Supabase notes

- Several route handlers still resolve scope through older helpers instead of `getRequestScope()`.
- Some service-role fallbacks are necessary, but they increase blast radius when route-level scope is weak.
- RLS coverage cannot be trusted as the only guard because many admin flows use service-role fallbacks.
- Client-side Supabase in admin modules remains the biggest security smell.
- Static RBAC audit passes after repairs.
- DB RBAC audit was not run because required service env vars were unavailable locally.

## UX notes

- Dept pages should not show department filters containing other departments.
- If a dept page is intentionally org-wide, it should not live under `/dept/[dept_id]`.
- Loading states should preserve page structure, not show generic bars.
- Exports must use the same active dept filter as the visible table.

## Recommended next issue

Replace remaining admin client Supabase list fetches with scoped API routes:

- departments
- office locations
- asset issues
- finance bills
- finance invoices
- finance reports
- weekly report admin dialog metadata
