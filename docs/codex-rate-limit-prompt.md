# Codex Task: Add Rate Limiting to 77 Remaining Mutation Routes

## Context

You previously claimed this task was complete. It is not. A grep run against
the actual working directory shows **77 mutation routes** with no `rateLimit()`
call. The verification command is at the bottom of this file — run it yourself
first, confirm the count, then fix every route on the list.

---

## The Exact Pattern to Use

This is the correct, complete pattern already used in `app/api/payments/route.ts`.
Copy it exactly. Do not invent variations.

**Imports to add at the top of every file (merge with existing imports):**
```typescript
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { apiError, ApiErrorCode } from "@/lib/api/errors"
```

**Rate limit block — goes INSIDE the handler function, as the FIRST statement,
before auth, before `request.json()`, before everything:**
```typescript
const rl = await rateLimit(`<route-key>:${getClientId(request)}`, { limit: 20, windowSec: 60 })
if (!rl.allowed) {
  return apiError("Too many requests. Please try again later.", ApiErrorCode.RATE_LIMITED, 429)
}
```

Replace `<route-key>` with a short kebab-case identifier for the route, e.g.:
- `app/api/fleet/bookings/route.ts` → `fleet-bookings`
- `app/api/help-desk/tickets/route.ts` → `helpdesk-tickets`
- `app/api/hr/leave/requests/route.ts` → `leave-requests`
- `app/api/correspondence/records/route.ts` → `correspondence-records`
- `app/api/reports/weekly-reports/route.ts` → `weekly-reports`

Each handler in a file gets its own key, e.g. if a file has both POST and PATCH:
- POST → `fleet-bookings-create`
- PATCH → `fleet-bookings-update`

---

## Critical: Fixing `_request` Parameter Names

Some routes declare the request parameter as `_request` (underscore prefix,
meaning "unused"). When you add rate limiting, the parameter IS used.
You must rename `_request` to `request` in those handlers.

**Before:**
```typescript
export async function PATCH(_request: NextRequest) {
```

**After:**
```typescript
export async function PATCH(request: NextRequest) {
```

Also ensure the import at the top has `NextRequest` (not just `Request`) since
`getClientId` accepts the base `Request` type but most handlers use `NextRequest`.
Both work — do not change `Request` to `NextRequest` if the route already uses
`Request`, just rename the underscore prefix.

---

## Rate Limit Values

| Route category | limit | windowSec |
|---|---|---|
| `dev/impersonation` | 5 | 60 |
| `admin/import-csv` | 5 | 60 |
| `admin/employees/export`, `reports/*export*` | 10 | 60 |
| `auth/create-profile` | 10 | 60 |
| `hr/leave/*` | 15 | 60 |
| `hr/performance/*` | 20 | 60 |
| `hr/attendance/*` | 10 | 60 |
| `help-desk/tickets/*` | 20 | 60 |
| `correspondence/*` | 20 | 60 |
| `fleet/*` | 15 | 60 |
| `payments/*` | 20 | 60 |
| `reports/*` (non-export) | 20 | 60 |
| `departments/*` | 20 | 60 |
| `profile/update` | 10 | 60 |
| `settings/*` | 15 | 60 |
| `admin/*` (all others) | 30 | 60 |
| `dev/*` (all others) | 10 | 60 |
| `onedrive/*` | 15 | 60 |
| Everything else | 20 | 60 |

---

## Complete List of Files to Fix

Work through every file below. Do not skip any. Do not batch them carelessly —
read each file before editing to understand which HTTP method handlers exist.

```
app/api/admin/assets/types/route.ts
app/api/admin/create-user/route.ts
app/api/admin/dev/impersonation/route.ts
app/api/admin/employees/export/route.ts
app/api/admin/hr/employees/[id]/email/route.ts
app/api/admin/hr/fleet/bookings/[id]/review/route.ts
app/api/admin/hr/fleet/resources/route.ts
app/api/admin/import-csv/route.ts
app/api/admin/maintenance/cleanup-idempotency/route.ts
app/api/admin/reject-user/route.ts
app/api/admin/scope-mode/route.ts
app/api/admin/settings/mail/route.ts
app/api/admin/users/role/route.ts
app/api/auth/create-profile/route.ts
app/api/correspondence/department-codes/route.ts
app/api/correspondence/records/route.ts
app/api/correspondence/records/[id]/approvals/route.ts
app/api/correspondence/records/[id]/dispatch/route.ts
app/api/correspondence/records/[id]/documents/route.ts
app/api/correspondence/records/[id]/route.ts
app/api/departments/route.ts
app/api/departments/[id]/route.ts
app/api/dev/flow-tests/route.ts
app/api/dev/leave-flow-test/route.ts
app/api/dev/login-log/route.ts
app/api/dev/maintenance/route.ts
app/api/fleet/bookings/route.ts
app/api/fleet/bookings/[id]/cancel/route.ts
app/api/help-desk/tickets/route.ts
app/api/help-desk/tickets/[id]/approvals/route.ts
app/api/help-desk/tickets/[id]/assign/route.ts
app/api/help-desk/tickets/[id]/comments/route.ts
app/api/help-desk/tickets/[id]/pivot/route.ts
app/api/help-desk/tickets/[id]/route.ts
app/api/hr/attendance/admin-records/route.ts
app/api/hr/attendance/clock-out/route.ts
app/api/hr/leave/evidence/route.ts
app/api/hr/leave/evidence/upload/route.ts
app/api/hr/leave/evidence/verify/route.ts
app/api/hr/leave/flow/route.ts
app/api/hr/leave/holidays/route.ts
app/api/hr/leave/lifecycle/route.ts
app/api/hr/leave/policies/route.ts
app/api/hr/leave/requests/route.ts
app/api/hr/leave/sla/reminders/route.ts
app/api/hr/leave/sla/route.ts
app/api/hr/performance/cbt/questions/route.ts
app/api/hr/performance/cbt/questions/[id]/route.ts
app/api/hr/performance/cbt/route.ts
app/api/hr/performance/cbt/session/route.ts
app/api/hr/performance/competencies/route.ts
app/api/hr/performance/cycles/route.ts
app/api/hr/performance/development-plans/actions/route.ts
app/api/hr/performance/development-plans/route.ts
app/api/hr/performance/goals/route.ts
app/api/hr/performance/goals/[id]/tasks/route.ts
app/api/hr/performance/peer-feedback/route.ts
app/api/hr/performance/reviews/route.ts
app/api/onedrive/route.ts
app/api/payments/categories/route.ts
app/api/payments/categories/[id]/route.ts
app/api/payments/[id]/documents/route.ts
app/api/payments/[id]/route.ts
app/api/profile/update/route.ts
app/api/reports/action-points-export/route.ts
app/api/reports/action-tracker/carry-forward/route.ts
app/api/reports/action-tracker/route.ts
app/api/reports/action-tracker/[id]/route.ts
app/api/reports/kss-results/route.ts
app/api/reports/kss-roster/route.ts
app/api/reports/meeting-date/route.ts
app/api/reports/meeting-week-documents/route.ts
app/api/reports/office-year-config/route.ts
app/api/reports/official-exports/route.ts
app/api/reports/weekly-report-export/route.ts
app/api/reports/weekly-reports/route.ts
app/api/settings/notifications/route.ts
```

---

## Rules

- Do not modify any business logic, return values, or auth checks.
- Only add the rate limit block and fix underscore-prefixed `_request` params
  where needed.
- Do not remove `export const dynamic = "force-dynamic"` from any file.
- Do not change HTTP status codes on any existing response.
- If a file already has `apiError` imported, do not add a duplicate import.
- If a file uses `NextResponse.json` for its 429 and does not import `apiError`,
  you may keep `NextResponse.json({ error: "Too many requests..." }, { status: 429 })`
  instead of adding the `apiError` import just for that — consistency within
  a file matters more than global uniformity on this one case.
- Never use `@ts-ignore`, `any`, or `console.log`.
- Commit in logical groups (e.g. all admin routes in one commit, all HR routes
  in one commit) with message format: `fix: add rate limiting to <section> routes`

---

## Mandatory Verification — Run This Before Claiming Done

Run this exact command in the repository root. It must return **zero lines of output**:

```bash
while IFS= read -r f; do
  grep -q "rateLimit" "$f" || echo "MISSING: $f"
done < <(grep -rl "export async function POST\|export async function PATCH\|export async function PUT\|export async function DELETE" app/api --include="*.ts")
```

If it returns any output, you are not done. Fix every remaining file it lists.

Then run:
```bash
npm run lint
npm run type-check
```

Both must pass with zero errors before committing.

Do not report completion until the grep above returns zero output AND lint and
type-check both pass. Do not self-verify by describing what you did — run the
commands and paste the output.
