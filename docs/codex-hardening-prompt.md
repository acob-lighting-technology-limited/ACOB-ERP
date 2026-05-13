# Codex Task: Backend Hardening & Code Quality

This is a production Next.js ERP backed by Supabase. The work here is purely
hardening — security, data integrity, consistency. No new features. No design
changes. No refactoring of business logic.

Read `AGENTS.md` fully before starting. Every rule there is mandatory.

---

## TASK 1 — Retire the Last RBAC v1 Call (1 file)

### Background
`lib/admin/access-policy.ts` is a thin adapter that internally delegates to
`lib/admin/policy-v2.ts`. There is exactly **one** remaining API route that
still imports the old `requireApiAdminScope` from it:

```
app/api/admin/employees/route.ts
```

### Steps
1. Read `app/api/admin/employees/route.ts` in full.
2. Read `lib/admin/api-guard-v2.ts` to see how v2 routes perform auth checks.
3. Replace the `requireApiAdminScope()` call in `employees/route.ts` with the
   equivalent v2 pattern used in other admin routes (look at
   `app/api/admin/approve-user/route.ts` or any route that uses
   `requireAccessContextV2` / `getRequestScope` for the correct pattern).
4. Verify the department scoping logic still applies correctly after the switch.
5. Run `npm run lint` and `npm run type-check`.

---

## TASK 2 — Add Request Size Limits to All Mutation Routes

### Background
Every route that calls `request.json()` parses the body without checking its
size first. A large enough payload will exhaust memory. This is a DoS vector.

### The Fix
Add a size check **before** `await request.json()` in every POST/PATCH/PUT
route. Use this exact helper — create it at `lib/api/request-size.ts`:

```typescript
import { NextResponse } from "next/server"

const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MB default

export function checkRequestSize(
  request: Request,
  maxBytes = MAX_BODY_BYTES
): NextResponse | null {
  const contentLength = request.headers.get("content-length")
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return NextResponse.json(
      { error: "Request body too large", code: "PAYLOAD_TOO_LARGE" },
      { status: 413 }
    )
  }
  return null
}
```

### Steps
1. Create `lib/api/request-size.ts` with the code above.
2. Find every route file that calls `await request.json()`:
   ```
   grep -r "request\.json()" app/api --include="*.ts" -l
   ```
3. For each file, add the size check at the top of the handler, immediately
   after auth and before parsing:
   ```typescript
   const sizeError = checkRequestSize(request)
   if (sizeError) return sizeError
   const body = await request.json()
   ```
4. File upload routes (correspondence, documents, media) may have a larger
   limit — use `checkRequestSize(request, 10 * 1024 * 1024)` (10 MB) for those.
5. Run `npm run lint` and `npm run type-check`.

---

## TASK 3 — Add Rate Limiting to All Mutation Routes

### Background
`lib/rate-limit.ts` exports `rateLimit(key, { limit, windowSec })`. It is
currently applied to only 9 routes. Every state-changing route needs it.

### Current usage pattern (reference — copy this):
```typescript
import { rateLimit, getClientId } from "@/lib/rate-limit"

// At top of handler, before auth:
const rl = await rateLimit(`payments:${getClientId(request)}`, { limit: 20, windowSec: 60 })
if (!rl.allowed) {
  return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 })
}
```

### Routes that need rate limiting added (POST/PATCH/PUT/DELETE only):
Find them with:
```
grep -r "export async function POST\|export async function PATCH\|export async function PUT\|export async function DELETE" app/api --include="*.ts" -l
```
Then cross-reference against the routes that already have it:
```
grep -r "rateLimit" app/api --include="*.ts" -l
```
The difference is your target list.

### Rate limit values by route sensitivity:
| Route pattern | Limit | Window |
|---|---|---|
| `/api/payments` mutations | 20 | 60s |
| `/api/tasks` mutations | 30 | 60s |
| `/api/hr/leave/requests` | 10 | 60s |
| `/api/correspondence` mutations | 20 | 60s |
| `/api/fleet` mutations | 15 | 60s |
| `/api/hr/performance` mutations | 20 | 60s |
| `/api/feedback` | 10 | 60s |
| `/api/profile` mutations | 10 | 60s |
| `/api/admin/*` mutations | 30 | 60s |
| All other mutations | 20 | 60s |

Use the route path segment as the key prefix, e.g.:
`rateLimit(`tasks-create:${getClientId(request)}`, { limit: 30, windowSec: 60 })`

### Steps
1. Build the list of routes missing rate limiting.
2. Add the rate limit call to each one, immediately after imports, at the very
   top of the handler function before auth.
3. Run `npm run lint` and `npm run type-check`.

---

## TASK 4 — Fix Multi-Step Database Operations to Use Postgres Transactions

### Background
Several API routes perform multiple sequential Supabase writes with no
transaction wrapping. If step 2 fails after step 1 succeeds, the database is
left in an inconsistent state. The worst offender is asset assignment.

### The Pattern to Use
Supabase supports transactions via database RPC functions. For each multi-step
operation, extract the steps into a Postgres function and call it via `.rpc()`.

### Operations that need this fix:

**1. Asset assignment** (`app/api/admin/assets/route.ts`)

Current flow (no transaction):
```
1. Close existing asset_assignments (UPDATE is_current = false)
2. Insert new asset_assignment
3. Update assets table status
4. Write audit log
```
If step 2 fails, step 1 already ran → asset has no active assignment.

**Fix**: Create a migration at `supabase/migrations/20260513100000_atomic_asset_assignment.sql`:
```sql
CREATE OR REPLACE FUNCTION public.atomic_assign_asset(
  p_asset_id        uuid,
  p_assigned_by     uuid,
  p_assigned_at     timestamptz,
  p_assignment_type text,
  p_assigned_to     uuid,
  p_department      text,
  p_office_location text,
  p_notes           text,
  p_handover_notes  text
)
RETURNS uuid   -- returns the new assignment id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment_id uuid;
BEGIN
  -- Close existing active assignments for this asset
  UPDATE asset_assignments
  SET is_current = false,
      handover_notes = p_handover_notes,
      handed_over_at = NOW()
  WHERE asset_id = p_asset_id AND is_current = true;

  -- Create the new assignment
  INSERT INTO asset_assignments (
    asset_id, assigned_by, assigned_at, is_current,
    assignment_notes, assignment_type,
    assigned_to, department, office_location
  ) VALUES (
    p_asset_id, p_assigned_by, p_assigned_at, true,
    p_notes, p_assignment_type,
    p_assigned_to, p_department, p_office_location
  )
  RETURNING id INTO v_assignment_id;

  -- Update asset status
  UPDATE assets SET status = 'assigned', updated_at = NOW()
  WHERE id = p_asset_id;

  RETURN v_assignment_id;
END;
$$;
```

Then in `app/api/admin/assets/route.ts`, replace the three sequential awaits
with a single `.rpc('atomic_assign_asset', { ... })` call.

**2. Leave approval state transitions** (`app/api/hr/leave/approve/route.ts`)

Read this route in full. Identify every place it does more than one sequential
write. Extract each into a Postgres RPC function using the same pattern above.

**3. Correspondence dispatch** (`app/api/correspondence/records/[id]/dispatch/route.ts`)

Same process — read, identify multi-step writes, extract to RPC.

### Steps
1. Read each of the three route files above.
2. Identify every multi-step write sequence.
3. Write migration files for each RPC function.
4. Update the route handlers to call `.rpc()` instead of sequential awaits.
5. The audit log write (`writeAuditLog`) can stay in the application layer
   since it is explicitly `failOpen: true` — it does not need to be in the
   Postgres transaction.
6. Run `npm run lint` and `npm run type-check`.

---

## TASK 5 — Fix String-Based Department Comparison in RLS Policies

### Background
9 migration files contain RLS policies that compare departments by text string:
```sql
profiles.department = action_items.department
```
If a department is renamed in the `departments` table, these policies silently
break — users either lose or gain access they should not have.

The `profiles` table already has a `department_id` FK column alongside the
text `department` column. The RLS policies must use the FK.

### Steps
1. Find all affected migrations:
   ```
   grep -r "profiles\.department\b" supabase/migrations --include="*.sql" -l
   ```
2. For each affected table, check whether it also has a `department_id` column.
   If not, you must add one — write a migration to add the FK column and
   backfill it from the `departments` table:
   ```sql
   ALTER TABLE public.<table_name>
     ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id);

   UPDATE public.<table_name> t
   SET department_id = d.id
   FROM public.departments d
   WHERE d.name = t.department;
   ```
3. Create a new migration file `20260513110000_fix_rls_department_fk.sql`.
4. In this migration, drop the affected policies and recreate them comparing
   `department_id` columns:
   ```sql
   -- Example: replacing string comparison with FK comparison
   DROP POLICY IF EXISTS "Leads can view their department items" ON public.action_items;
   CREATE POLICY "Leads can view their department items"
     ON public.action_items FOR SELECT
     USING (
       EXISTS (
         SELECT 1 FROM public.profiles p
         WHERE p.id = auth.uid()
         AND (
           p.role IN ('admin', 'super_admin', 'developer')
           OR (p.is_department_lead = true AND p.department_id = action_items.department_id)
         )
       )
     );
   ```
5. Apply the same pattern to every other policy with string department comparison.
6. Do NOT drop the old text `department` columns — other application code still
   reads them. Only fix the RLS policies to use IDs.

---

## TASK 6 — Add Idempotency Key Expiry

### Background
`lib/idempotency.ts` stores idempotency keys in the database to prevent
duplicate submissions. There is no expiry or cleanup. The table will grow
indefinitely and can contain sensitive response data.

### Steps
1. Read `lib/idempotency.ts` in full to understand the table and schema.
2. Find the migration that created the idempotency table:
   ```
   grep -r "idempotency" supabase/migrations --include="*.sql" -l
   ```
3. Write a new migration `20260513120000_idempotency_key_expiry.sql`:
   ```sql
   -- Add expires_at column
   ALTER TABLE public.idempotency_keys
     ADD COLUMN IF NOT EXISTS expires_at timestamptz
       NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');

   -- Index for cleanup
   CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
     ON public.idempotency_keys (expires_at);

   -- Backfill: existing rows expire immediately (they're already old)
   UPDATE public.idempotency_keys
   SET expires_at = NOW()
   WHERE expires_at IS NULL OR expires_at > NOW() + INTERVAL '24 hours';

   -- Auto-cleanup function (called by a pg_cron job or triggered manually)
   CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
   RETURNS integer
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $$
   DECLARE v_count integer;
   BEGIN
     DELETE FROM public.idempotency_keys WHERE expires_at < NOW();
     GET DIAGNOSTICS v_count = ROW_COUNT;
     RETURN v_count;
   END;
   $$;
   ```
4. Update `lib/idempotency.ts` — when storing a new key, write `expires_at`:
   ```typescript
   expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
   ```
5. Update the idempotency check query to filter out expired keys:
   ```typescript
   .eq("key", idempotencyKey)
   .gt("expires_at", new Date().toISOString())
   ```
6. Create a new API route `app/api/admin/maintenance/cleanup-idempotency/route.ts`
   that calls `.rpc("cleanup_expired_idempotency_keys")`. Protect it with
   `requireApiAdminScope` (developer/super_admin only). This gives you a
   manual trigger. A pg_cron job can also call it on a schedule.

---

## TASK 7 — Add Error Codes to API Responses

### Background
API routes return `{ error: "some string" }`. Client code must parse error
strings to decide what to do. Strings change; codes don't.

### The Fix
Every API error response must include a `code` field with a stable machine-
readable string. Client code can switch on `code` instead of matching strings.

### Standard error code format: `SCREAMING_SNAKE_CASE`

### Steps
1. Create `lib/api/errors.ts`:
```typescript
export const ApiErrorCode = {
  // Auth
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  // Input
  VALIDATION_ERROR: "VALIDATION_ERROR",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  MISSING_REQUIRED_FIELD: "MISSING_REQUIRED_FIELD",
  // Rate limiting
  RATE_LIMITED: "RATE_LIMITED",
  // Business logic
  ALREADY_EXISTS: "ALREADY_EXISTS",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INVALID_STATE: "INVALID_STATE",
  // Server
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export function apiError(
  message: string,
  code: ApiErrorCode,
  status: number,
  details?: unknown
) {
  return Response.json(
    { error: message, code, ...(details ? { details } : {}) },
    { status }
  )
}
```

2. Update the most-called routes first — `payments`, `tasks`, `leave`, `assets`
   — replacing bare `NextResponse.json({ error: "..." }, { status: N })` with
   `apiError("...", ApiErrorCode.X, N)`.

3. For Zod validation errors, always use:
   ```typescript
   return apiError(
     parsed.error.issues[0]?.message ?? "Validation failed",
     ApiErrorCode.VALIDATION_ERROR,
     400,
     parsed.error.issues
   )
   ```

4. For `401` responses: `ApiErrorCode.UNAUTHORIZED`
5. For `403` responses: `ApiErrorCode.FORBIDDEN`
6. For `429` responses: `ApiErrorCode.RATE_LIMITED`
7. For `500` database errors: `ApiErrorCode.DATABASE_ERROR`
8. For `500` unexpected errors: `ApiErrorCode.INTERNAL_ERROR`

Do not change HTTP status codes — only add the `code` field. Existing clients
that read `error` strings will still work.

---

## TASK 8 — Standardise Forms on React Hook Form

### Background
Form components use two different patterns. Some use `react-hook-form` with
`zodResolver`. Others use raw `useState` + manual onChange handlers + manual
validation. The raw-state pattern produces more code, has no built-in
validation, and is inconsistent with the rest of the codebase.

### How to identify raw-state forms
Look for components that:
- Have `const [formData, setFormData] = useState({...})` or multiple field-level states
- Have a `handleSubmit` function that manually checks fields
- Do NOT import `useForm` from `react-hook-form`
- Contain `<input onChange={(e) => setFormData(...)} />`

Find them:
```
grep -r "useState" components --include="*.tsx" -l | xargs grep -L "useForm" | xargs grep -l "onSubmit\|handleSubmit"
```

### Conversion pattern
**Before (raw state):**
```typescript
const [title, setTitle] = useState("")
const [amount, setAmount] = useState("")

function handleSubmit() {
  if (!title) { setError("title required"); return }
  // ...
}
```

**After (react-hook-form + zod):**
```typescript
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

const Schema = z.object({
  title: z.string().min(1, "Title is required"),
  amount: z.number().positive("Amount must be positive"),
})
type FormValues = z.infer<typeof Schema>

const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
  resolver: zodResolver(Schema),
  defaultValues: { title: "", amount: 0 },
})
```

### Priority order — convert these first:
1. `components/payments/create-payment-dialog.tsx`
2. `components/payments/payment-edit-dialog.tsx`
3. Any other dialog/form component in `components/` that does not import `useForm`

### Rules:
- Keep the same field names so existing API calls are not broken
- Use the Zod schemas already in `lib/validation.ts` where they exist — do
  not invent new schemas for things already validated there
- Do not change what the form submits to the API. Only change how the form
  state is managed internally.
- After converting each component, run `npm run lint` and `npm run type-check`
  before moving to the next one.

---

## Completion Checklist

After all tasks:

- [ ] `npm run lint` passes (zero warnings)
- [ ] `npm run type-check` passes
- [ ] `npm run build` passes
- [ ] No `requireApiAdminScope` calls remain in `app/api/` (Task 1)
- [ ] `lib/api/request-size.ts` exists and is imported in every POST/PATCH/PUT route (Task 2)
- [ ] Every mutation route has a `rateLimit(...)` call (Task 3)
- [ ] Migration `20260513100000_atomic_asset_assignment.sql` exists (Task 4)
- [ ] Asset assignment route uses `.rpc('atomic_assign_asset', ...)` (Task 4)
- [ ] Migration `20260513110000_fix_rls_department_fk.sql` exists (Task 5)
- [ ] Migration `20260513120000_idempotency_key_expiry.sql` exists (Task 6)
- [ ] `lib/idempotency.ts` writes and checks `expires_at` (Task 6)
- [ ] `lib/api/errors.ts` exists with `apiError()` helper (Task 7)
- [ ] Payment, task, leave, and asset routes use `apiError()` (Task 7)
- [ ] No raw-`useState` form patterns remain in payment dialogs (Task 8)

## Rules
- Never use `@ts-ignore` or `@ts-nocheck`.
- Never use `any` — use `unknown` and narrow.
- Never `console.log` — use `logger("module-name")` from `@/lib/logger`.
- Never bypass pre-commit hooks (`--no-verify`).
- Commit each task separately with a `fix:` or `refactor:` prefix.
- Stage files explicitly — never `git add -A`.
- Run lint + type-check after every task before committing.
