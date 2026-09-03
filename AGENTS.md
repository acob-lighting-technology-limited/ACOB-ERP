# Repository Agent Standards

This file defines the minimum engineering standards that AI agents must follow when working in this repository. These rules are intended to prevent lint debt, weak typing, build regressions, and workflow bypasses.

## Delivery Standard

Do not treat a task as complete until all required checks pass:

- `npx eslint . --ext .ts,.tsx`
- `npx tsc --noEmit`
- **Commit Every Good Work Done**: Once changes satisfy all required checks (`npx eslint`, `npx tsc --noEmit`) and migrations are verified, **always commit the verified work promptly** following the [Commit Grouping Strategy](#commit-grouping-strategy--mandatory-before-any-commit). Never leave completed, verified work uncommitted in the working tree across conversational turns or user requests. Do not wait for the user to prompt you to commit good work.
- **Database Migration Execution**: If any new `.sql` migrations were created or modified under `supabase/migrations/`:
  - **Always run `npx supabase migration list` to determine actual deployment status.** This is the sole source of truth — not `git status`.
  - A migration file that is untracked or unstaged in git is **not** automatically pending. Check the output of `migration list`: if the `remote` column is populated for that version, it has already been applied. Only flag a migration as pending if its `remote` field is empty.
  - Do **not** infer migration status from `git status` alone. Untracked files may already be live.
  - If any migration has an empty `remote` field, push it: `npx supabase db push --include-all --yes`
  - If a migration cannot be pushed automatically or is intentionally held back, **always explicitly state and remind the user that the SQL migration is pending and has not been pushed to the live database**.
<!-- - `npm run build` -->

If a change cannot satisfy all checks or if migrations remain unapplied without explicit user consent, report the blocker/pending status clearly instead of claiming completion.

## Technical Honesty — Do Not Default to Agreement

Agreeing with a proposal you believe is wrong is a failure, not politeness. When the
user suggests an approach — in a question, a "right?", or a direct instruction — judge
it on the merits and say what you actually think **before** acting.

- If the suggestion is not the right call, or departs from industry standard or an
  established convention in this repo, **say so plainly and give the reason**. Cite the
  concrete cost: the bug it invites, the a11y or contrast rule it breaks, the standard
  in `AGENTS.md` it contradicts, the maintenance burden it adds.
- A question phrased as "should we…?" or "…right?" is a request for your judgement, not
  for confirmation. Answer it, don't echo it.
- Never validate a decision you would not have made yourself. Do not soften a real
  objection into "that could work too."
- Be equally direct about your own work: if you overstated a claim, got a fact wrong, or
  a check failed, correct it and report the failure rather than glossing it.
- Concede specifically when the user is right — including when they are right about part
  of a point you disagree with overall. Partial agreement stated precisely is more useful
  than blanket agreement or blanket resistance.
- Offer the better alternative, not just the objection. "No, because X — do Y instead" is
  the useful shape.

**After the objection has been made and the user reaffirms their choice, it is their
call.** State the trade-off once, then implement what they asked, fully and well. Do not
re-litigate it, do not quietly implement a different thing, and do not sandbag the work.

## Git and Hook Policy

- Always commit every good, verified work done promptly. Never leave completed tasks unstaged or uncommitted.
- Never use `git commit --no-verify`.
- Never use `git push --no-verify`.
- Do not bypass failing hooks. Fix the underlying issue.
- Pre-commit must pass `lint-staged` including ESLint and Prettier.
- Pre-push must pass `npm run build`.
- Confirm the build passes locally before pushing.

## Commit Grouping Strategy — Mandatory Before Any Commit

**Never commit all uncommitted changes in a single `git add -A && git commit`.** You MUST commit every good unit of work done upon completing a task, feature, or fix. Always follow this workflow before committing:

### Step 1 — Analyse before staging
Run `git diff --stat HEAD` and `git status --short` to get the full list of modified and untracked files. Do **not** stage anything yet.

### Step 2 — Group by feature domain
Cluster files into logical groups based on their relationships. Use the following rules to determine groupings:

- Files that share a feature domain belong together (e.g. all lunch-related app pages, API routes, components, lib helpers, and migrations go in one commit).
- A migration file belongs in the **same commit** as the feature code that required it — never commit a migration separately unless it is a hotfix with no associated application code.
- Shared infrastructure changes (`layout.tsx`, `navbar.tsx`, `constants.ts`, `lib/utils/*`, email templates, etc.) that do not belong to a single feature should be batched into a single `chore:` or `refactor:` commit.
- Small, isolated fixes (1–3 files, unrelated to a feature) should each be their own commit.
- Never mix unrelated features into a single commit — a commit must be coherent and independently revertable.

### Step 3 — Stage and commit in order
Stage and commit each group one at a time using `git add <specific files>` — never `git add -A` or `git add .` for the whole working tree at once.

### Hard prohibitions
- ❌ `git add -A` or `git add .` covering unrelated files
- ❌ Committing all changes in one shot without grouping analysis
- ❌ Splitting a feature's migration into a separate commit from its app code

## Commit Message Standard

- Format commits as `type: description`.
- Use a single-line, lowercase subject.
- Keep the full message to 72 characters or fewer.
- Do not end the subject with a period.
- Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `build`, `revert`.

Examples:

- Good: `fix: resolve build error`
- Bad: `fix: Resolve Build Error`
- Bad: `security: do xyz`

## TypeScript and Linting Policy

- Do not add `@ts-nocheck`.
- Do not add `@ts-ignore` unless there is no practical alternative and the reason is documented inline.
- Do not disable lint rules to avoid fixing the real problem.
- Do not introduce `any` unless there is no practical alternative.
- Prefer `unknown`, narrow interfaces, discriminated unions, typed helper results, or explicit DTOs.
- If `any` is used temporarily during a refactor, remove it before finishing the task.

## Supabase Typing Standard

- Do not assume every real table or column exists in `@/types/database`.
- If generated Supabase types are incomplete or stale, define a narrow local type for the selected row shape.
- Do not force broken references like `Database["public"]["Tables"][...]` when the table is not represented correctly.
- When working with joins, type the selected result shape explicitly instead of relying on deep inference.
- Prefer local row types over broad casts.

## Database Security Standard — RLS, Grants & Functions (Mandatory)

**Core principle:** the Supabase `anon` key is public and ships in the browser. PostgREST exposes every table and RPC directly to the internet at `/rest/v1/*` and `/rest/v1/rpc/*`, **bypassing Next.js, middleware, `lib/admin/rbac.ts`, and `lib/admin/policy-v2.ts` entirely.** App-layer authorization does **not** protect this path. The **only** server-side boundary on the anon path is database Row-Level Security (RLS) and function `EXECUTE` grants. Treat every table and `SECURITY DEFINER` function as internet-facing.

Non-negotiable rules:

1. **Every new table enables RLS in the same migration that creates it**, with at least one explicit policy. A `CREATE TABLE` without `ENABLE ROW LEVEL SECURITY` is world-readable *and* world-writable via the anon key (the `anon`/`authenticated` roles hold blanket table grants in this project).
2. **Never write a permissive policy for untrusted roles.** No `USING (true)` and no policy with role `public` or `anon` on any table holding non-public data. Scope every policy `TO authenticated` and gate it with `has_role(...)`, `auth.uid() = <owner_col>`, or an equivalent predicate.
3. **Never disable RLS on a production table to "fix" a query.** Empty results or `permission denied` mean the policy is wrong or the wrong client is used — fix the policy, or read via the service-role client in a server route. Disabling RLS turns the table wide open and is the exact cause of past incidents.
4. **Browser code never relies on loose RLS.** Sensitive reads/writes go through server API routes using the service-role client (`getServiceRoleClientOrFallback` / `getServiceClient`), which bypasses RLS. The RLS policy is the backstop, not the app's data path.
5. **`SECURITY DEFINER` functions:**
   - Never trust a caller-supplied identity. Derive it from `auth.uid()`; if a `p_user_id`-style parameter is unavoidable, guard with `IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN RAISE EXCEPTION ...` (this allows the service role, whose `auth.uid()` is null, while blocking authenticated impersonation).
   - **Always `REVOKE EXECUTE ON FUNCTION ... FROM anon, PUBLIC` in the creating migration.** Postgres grants `EXECUTE` to `PUBLIC` by default and `anon` inherits it — revoking from `anon` alone is not enough. Then `GRANT EXECUTE` explicitly only to the roles that need it (`authenticated` and/or `service_role`).
   - Functions that return or mutate sensitive data must check role internally (do not rely on the app layer to gate a directly-callable RPC).
6. **Sequence / counter RPCs** (employee numbers, correspondence references, etc.) require an authenticated privileged role plus rate limiting — never anon/`PUBLIC`.
7. **Migrations are the only way to change schema, policies, or grants in production.** No hand edits in the Supabase dashboard or SQL editor — they drift from the repo (which cannot see them) and leave no audit trail.
8. **Review/CI gate — reject a migration if it:** creates a table without `ENABLE ROW LEVEL SECURITY` + a policy; adds a policy with role `public`/`anon` on non-public data; or defines a `SECURITY DEFINER` function without a matching `REVOKE EXECUTE ... FROM PUBLIC`.
9. **Verify after every RLS/grant/function change** by impersonating the anon role: `BEGIN; SET LOCAL ROLE anon; <attempt the access>; ROLLBACK;` — confirm intended access is denied. Do not assume the repo reflects production; check live state.
10. **Governance:** MFA must be enabled on all Supabase org members; direct production DDL access must be restricted; keep public sign-up (`disable_signup`) off unless a self-service flow explicitly requires it (an open `auth.users` signup lets anyone mint a valid UUID regardless of the in-app approval workflow).
11. **Mandatory Remote Push & Live Sync Verification**: Writing a migration file in `supabase/migrations/` is only step one. Always run `npx supabase migration list` to confirm live sync status. A migration is only considered applied if its `remote` column is populated in that output. Do **not** use `git status` or the presence/absence of a local file as a proxy for deployment status — an untracked file may already be live.
12. **Enforce Pending Migration Reminders**: Never claim or imply a task is complete if a migration's `remote` field is empty in `npx supabase migration list`. If a migration is not yet applied to the remote database for any reason, **always explicitly remind the user and clearly state that the SQL migration is pending and has not been pushed to the live database**. Conversely, do **not** flag a migration as pending purely because it is untracked or unstaged in git — verify against the live output first.
13. **PostgreSQL View Mutation Rule**: Never use standalone `CREATE OR REPLACE VIEW` when modifying existing views if columns, column order, or data types change (PostgreSQL will reject this with `cannot drop columns from view (SQLSTATE 42P16)`). Always prefix with `DROP VIEW IF EXISTS <view_name> CASCADE;` followed by `CREATE VIEW <view_name> AS ...` and explicit grants (`GRANT SELECT ON <view_name> TO authenticated, service_role;`).

## Query Construction Rules

Be cautious with helper wrappers around Supabase queries in build-sensitive code.

- Helper chains such as `applyAssignableStatusFilter(...)` can trigger `Type instantiation is excessively deep and possibly infinite` during `next build`.
- In server components, route handlers, diagnostics, and admin pages, prefer:
- direct `supabase.from(...).select(...)` queries
- explicit local row types
- manual filtering with `isAssignableEmploymentStatus(...)` when needed
- If a helper begins causing deep generic inference failures, replace it with a direct query and explicit post-filtering.

## `services/` vs `lib/` Placement Rule

- Put reusable data-access helpers (Supabase queries, fetch wrappers, DB CRUD utilities) under `lib/`.
- Use `services/` only for true orchestration/business-flow layers that coordinate multiple `lib/` modules.
- Do not create new top-level `services/` files for single-table CRUD wrappers; place them in `lib/services/` or the relevant `lib/<domain>/` folder.

## Nullability Discipline

- Do not pass `string | null | undefined` to code that requires `string`.
- Normalize nullable values before use.
- Guard required values early.
- When writing type predicates, make sure the narrowed type is assignable to the source type.

Preferred patterns:

- `const role = profile.role || ""`
- `const stageCode = item.current_stage_code || item.approval_stage || ""`
- `if (!value) return NextResponse.json(...)`

## React Compatibility

- Do not use `useEffectEvent` unless the installed React version in this repository supports it.
- Do not resolve hook dependency warnings mechanically if doing so changes runtime behavior.
- Prefer stable helpers, refactors, or clearer state flow over unsafe dependency-array edits.

## Logging and Audit Expectations

- Use `logger("module-name")` from `@/lib/logger` instead of `console.log`.
- Use `writeAuditLog()` from `@/lib/audit/write-audit` with `failOpen: true` for non-blocking audit logging where applicable.

## API Versioning

- Canonical API routes belong under `/api/`.
- Do not add new features to `/api/v1/` unless the task is explicitly about backward compatibility or legacy maintenance.

---

## Department Console Scoping Standard — Mandatory for Every `app/dept/[dept_id]/*` Route

Department console pages are not mini-admin shortcuts. They are single-department
surfaces. Every page under `app/dept/[dept_id]/*` must stay locked to the
requested department across server queries, client fetches, filters, exports,
stats, expandable rows, dialogs, and child tabs.

### Required pattern

- Call `requireDeptScope(dept_id)` at the top of every dept page.
- Use `scope.deptName` and `scope.deptId` as the only allowed department scope.
- If reusing an admin component, pass explicit locking props such as
  `lockedDepartment`, `lockedDepartmentId`, `scopedDepartments`, or equivalent.
- Any child component that fetches data must receive and forward the same locked
  department value to its API call.
- Empty result sets must stay empty. They must not fall back to all departments.

### Hard prohibitions

- ❌ Reusing an admin client component in `/dept/[dept_id]` without a lock prop
- ❌ Fetching `/api/admin/*`, `/api/hr/*`, or `/api/payments` from a dept page without a department constraint
- ❌ Defaulting dept tabs or subviews to `"all"` after the wrapper already scoped the page
- ❌ Showing filter options for departments outside `scope.deptName`
- ❌ Letting exports include rows outside the active dept console

---

## Admin Route Scoping Standard — Mandatory for Every `app/admin/*` Page and API Route

All admin pages and their backing API routes must enforce department-level scoping via the
centralized helpers in `lib/admin/api-scope.ts`. This is **non-negotiable** — it is the
single source of truth for what data a user is allowed to see.

### How it works

The middleware resolves the current user's scope once and stamps it on every server request
as an internal `x-admin-scope` header. Individual pages and routes read that header — they
never re-derive scope themselves.

```ts
import { getRequestScope, getScopedDepartments } from "@/lib/admin/api-scope"

// In a server component or API route handler:
const scope = await getRequestScope()
const depts = getScopedDepartments(scope)
// depts === null  → global admin, no filter needed
// depts === []    → lead with empty scope, return nothing
// depts === [...] → lead/admin in lead mode, filter by these dept names
```

### Rules for server components (`"use server"` / no `"use client"`)

```ts
// ✅ Correct — server-side, scoped
const scope = await getRequestScope()
const depts = getScopedDepartments(scope)
let query = supabase.from("employees").select("*")
if (depts !== null) query = query.in("department", depts)
const { data } = await query
```

### Rules for client components (`"use client"`)

**Client components MUST NOT query Supabase directly.** The browser-side Supabase
client bypasses all middleware — no scope header is set, and filtering is ignored.

```ts
// ❌ FORBIDDEN in a "use client" component
const { data } = await supabase.from("profiles").select("*")

// ✅ Required — call a scoped API route instead
const res = await fetch("/api/hr/performance/employees")
const { data } = await res.json()
```

Every data-fetching client component must call an `/api/` route that applies
`getRequestScope()` server-side. Never add ad-hoc role checks like
`is_department_lead && !isAdminLike` — these are wrong and have caused leaks.

### Rules for `/api/` route handlers

Every GET handler that returns a list of records scoped to an organisation must call
`getRequestScope()` and filter accordingly:

```ts
// ✅ Every list route handler
export async function GET(request: NextRequest) {
  const scope = await getRequestScope()
  if (!scope) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  const depts = getScopedDepartments(scope)

  let query = supabase.from("my_table").select("*")
  if (depts !== null) {
    if (depts.length === 0) return NextResponse.json({ data: [] })
    query = query.in("department", depts)
  }
  // ...
}
```

### Pages that are intentionally org-wide (no dept filter needed)

Some pages are inherently org-wide and correct not to dept-filter:

- `app/admin/dev/*` — developer-only diagnostics
- `app/admin/settings/*` — role/user management (super_admin only)
- `app/admin/finance/*` — org-wide finance
- `app/admin/inventory/*` — org-wide stock
- `app/admin/purchasing/*` — org-wide purchasing
- `app/admin/hr/office-location` — org-wide location list
- `app/admin/hr/departments` — org-wide department list

Even these must still call `getRequestScope()` and gate on `scope.isAdminLike` to
prevent lead-mode access to sections that should be admin-only.

### Hard prohibitions

- ❌ `supabase.from(...)` inside a `"use client"` admin component
- ❌ `if (profile.is_department_lead && !isAdminLike)` — always broken
- ❌ Returning all rows from a list route without calling `getRequestScope()`
- ❌ Passing employee/department data to a dialog without going via a scoped `/api/` route
- ❌ Creating a new admin page or API route without applying this pattern

---

## Table Page Standard — Mandatory for All List/Data Pages

Every page that shows a list of records **must** use `DataTablePage` + `DataTable`
from `@/components/ui/data-table`. Never build a one-off table with raw
`<Table>` / `<PageWrapper>` markup. The only acceptable exception is an
embedded sub-table inside a component that is already rendered inside a
`DataTablePage` (e.g. a calibration view).

### Required file structure

```
app/admin/<section>/<page>/
  page.tsx                    ← root: uses DataTablePage + DataTable
  _components/                ← page-specific sub-components only
    <name>-dialog.tsx
    <name>-card.tsx
```

### Mandatory layout order — never rearrange

```
1. Page header     title · icon · back link · action buttons (Add, Export…)
2. Tabs            only when the page has 2–5 named views of the same data
3. Stats cards     3–4 StatCard items — total, a key status, a period, a %
4. DataTable       renders internally in this fixed order:
     a. Search bar (debounced 300ms) + Columns toggle + View toggle
     b. Filter dropdowns  (minimum 2 per table page)
     c. Active filter pills + "Clear all" button
     d. Row count  — always visible: "X results" / "Showing X–Y of Z"
     e. Skeleton rows while loading  (never a spinner)
     f. Table (sticky header, coloured header row, S/N column)
        OR card grid when in card view / on mobile
     g. Pagination controls
```

### DataTablePage usage

```tsx
import { DataTablePage } from "@/components/ui/data-table"

<DataTablePage
  title="Page Title"
  description="Short description."
  icon={SomeLucideIcon}
  backLink={{ href: "/admin/section", label: "Back to Section" }}
  tabs={TABS}               // optional — DataTableTab[]
  activeTab={tab}           // required when tabs provided
  onTabChange={setTab}      // required when tabs provided
  stats={<StatsRow />}      // strongly recommended
  actions={
    <div className="flex gap-2">
      <Button variant="outline" size="sm"><Download /> Export</Button>
      <Button size="sm"><Plus /> Add Item</Button>
    </div>
  }
>
  <DataTable ... />
</DataTablePage>
```

### DataTable usage

```tsx
import { DataTable } from "@/components/ui/data-table"
import type { DataTableColumn, DataTableFilter } from "@/components/ui/data-table"

const columns: DataTableColumn<MyRow>[] = [
  {
    key: "name",
    label: "Name",
    sortable: true,
    accessor: (r) => r.name,
    render: (r) => <span className="font-medium">{r.name}</span>,
    resizable: true,   // optional — enables drag-to-resize handle
    initialWidth: 200, // optional — starting width in px when resizable
  },
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusBadge status={r.status} />,
    hideOnMobile: true,
  },
]

const filters: DataTableFilter<MyRow>[] = [
  // minimum 2 filters per table page
  {
    key: "department",
    label: "Department",
    options: departments.map((d) => ({ value: d, label: d })),
    // mode: "column" (default) matches against the accessor of the column
    // with the same key. Use mode: "custom" + filterFn for complex logic.
  },
  {
    key: "status",
    label: "Status",
    options: STATUS_OPTIONS,
  },
]

<DataTable<MyRow>
  data={rows}
  columns={columns}
  getRowId={(r) => r.id}
  searchPlaceholder="Search name, department…"
  searchFn={(row, q) => row.name.toLowerCase().includes(q)}
  filters={filters}
  isLoading={isLoading}
  error={error}
  onRetry={reload}
  pagination={{ pageSize: 50 }}                  // optional
  rowActions={[{ label: "Edit", onClick: open }]} // optional
  expandable={{ render: (r) => <Detail row={r} /> }} // optional
  bulkActions={[{ label: "Delete", onClick: bulkDelete, variant: "destructive" }]}
  selectable   // enable row checkboxes
  viewToggle   // show list/card toggle
  cardRenderer={(r) => <MyCard row={r} />}        // required with viewToggle
  urlSync      // persist search + filters in URL query params
/>
```

### Feature checklist — built-in, never re-implement manually

| Feature | Auto | Notes |
|---------|------|-------|
| Muted header row | ✅ | `bg-muted/80` — do not change |
| Sticky header on scroll | ✅ | Always on |
| Search with 300ms debounce | ✅ | Pass `searchFn` |
| Clear search × button | ✅ | Inline in the search field |
| Active filter pills + clear all | ✅ | Appears whenever any filter is active |
| Multi-select filter dropdowns | ✅ | Pass `filters` |
| Column visibility toggle | ✅ | Sliders button, top-right of filter bar |
| Column drag-to-resize | ✅ | Set `resizable: true` on column + `initialWidth` |
| Column drag-to-reorder | ✅ | Hover any column header to reveal grip handle, drag left/right |
| Sortable columns with arrows | ✅ | Set `sortable: true` on column |
| S/N row numbers | ✅ | Disable with `showRowNumbers={false}` |
| Row count always visible | ✅ | "X results" without pagination; "Showing X–Y of Z" with it |
| Skeleton loading (shimmer rows) | ✅ | Pass `isLoading` — matches column count |
| Error state + retry button | ✅ | Pass `error` + `onRetry` |
| Empty state with clear-filters CTA | ✅ | Different message: no data vs no filter match |
| Client-side pagination | ✅ | Pass `pagination: { pageSize: N }` |
| Server-side pagination | ✅ | Add `serverSide: true` + `totalRows` + `onPageChange` |
| Expandable rows | ✅ | Pass `expandable` |
| Row actions | ✅ | Pass `rowActions` |
| Bulk select + actions toolbar | ✅ | Pass `selectable` + `bulkActions` |
| Keyboard navigation ↑↓ / Enter | ✅ | Always on |
| List / card view toggle | ✅ | Pass `viewToggle` + `cardRenderer` |
| List / card view toggle (mobile) | ✅ | Mobile defaults to list view with horizontal scroll; users opt into card view via the toggle |
| URL-synced filters | ✅ | Pass `urlSync` — search + filters write to query params |

### Stats cards — required on every table page

```tsx
import { StatCard } from "@/components/ui/stat-card"

<div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
  <StatCard title="Total"   value={total}   icon={Users}      iconBgColor="bg-blue-500/10"    iconColor="text-blue-500" />
  <StatCard title="Active"  value={active}  icon={Check}      iconBgColor="bg-emerald-500/10" iconColor="text-emerald-500" />
  <StatCard title="Pending" value={pending} icon={Clock}      iconBgColor="bg-amber-500/10"   iconColor="text-amber-500" />
</div>
```

### Tabs — when to use

Use tabs when a page has 2–5 different views of **the same data source**
(e.g. Individual / Department / Cycle). Do **not** create separate pages for
views that share the same shell and data fetch.

```tsx
const TABS: DataTableTab[] = [
  { key: "all",      label: "All" },
  { key: "active",   label: "Active" },
  { key: "archived", label: "Archived" },
]
```

### Export — placement rule

Export button always lives in the page header `actions`. Never inside the
table or filter bar. Use `ExportOptionsDialog` from
`@/components/admin/export-options-dialog`. Export logic lives in
`@/lib/<section>/export.ts`.

### Back link convention

| Page location | Back link |
|--------------|-----------|
| `/admin/hr/pms/…` | `{ href: "/admin/hr/pms", label: "Back to PMS" }` |
| `/admin/hr/…` | `{ href: "/admin/hr", label: "Back to HR" }` |
| `/admin/…` | `{ href: "/admin", label: "Back to Admin" }` |

### Colour / design token standards

| Element | Class |
|---------|-------|
| Table header row | `bg-muted/80` |
| Filter card border | `border-2` |
| Blue stat icon | `bg-blue-500/10` + `text-blue-500` |
| Green stat icon | `bg-emerald-500/10` + `text-emerald-500` |
| Amber stat icon | `bg-amber-500/10` + `text-amber-500` |
| Red stat icon | `bg-red-500/10` + `text-red-500` |
| Purple stat icon | `bg-violet-500/10` + `text-violet-500` |

### Hard prohibitions

- ❌ Raw `<Table>` / `<TableHeader>` inside a page component
- ❌ `<DialogContent>` inside a page component; move dialogs to `_components/`
- ❌ Inline search or filter state in a page — all handled by `DataTable`
- ❌ `<Loader2>` spinner for table loading — skeletons are automatic
- ❌ Fewer than 2 filter options on any table page
- ❌ A table page with no metrics at all — supply `stats` (StatCards), `statBadges`,
  or both. Prefer `statBadges` with `statBadgeStyle="line"` on lookup and record
  pages: four cards fill a phone screen before any data. Pass both only when the
  cards genuinely earn a desktop band; they then render `md`-and-up while the line
  covers mobile.
- ❌ A table page without `DataTablePage` as the root wrapper

### The one exception to inline filter state — controlled filters

`DataTable` owns search and filter state. The single sanctioned way for a page to
hold filter values is `DataTable`'s controlled mode:

```tsx
const [filterValues, setFilterValues] = useState<Record<string, string[]>>({
  staff_type: ["permanent"], // seed here; `defaultValues` is ignored when controlled
})

<DataTable filterValues={filterValues} onFilterValuesChange={setFilterValues} … />
```

Use it **only** when UI outside the toolbar has to drive a filter — an interactive
stat badge that toggles its own metric, a summary tile that filters to its row. It is
not a licence to hand-roll filtering: the toolbar still renders every control and
still owns the interaction; the page only holds the values.

Rules when controlled:

- Pass **both** props. `filterValues` without `onFilterValuesChange` freezes the
  toolbar — the user's clicks are reported nowhere and nothing changes.
- Seed defaults in the parent's initial state. `defaultValues` on a filter definition
  is ignored in controlled mode, and leaving it in place misstates where the default
  comes from.
- Never filter the `data` you pass in. `DataTable` applies the filters; pre-filtering
  as well double-applies them and desynchronises the result count.
- Make a stat interactive only where the metric maps to a filter one-to-one. A count
  of *distinct* values ("12 offices") has no single value to filter to, and a badge
  that looks pressable but is inert is worse than a plain one.

If nothing outside the toolbar drives the filter, leave it uncontrolled. That is
still the default and still what most pages should do.

One caveat: `urlSync` *writes* controlled values to the URL but does not read them
back into the parent on mount — only `DataTable`'s internal state is seeded from
the URL. A page that must open pre-filtered from a link has to read the params
itself when it seeds its state.

### Contacts view

`contactsView` + `defaultViewMode="contacts"` renders the `mobileRow` list at every
breakpoint. Two rules follow from `groupBy`:

- **With `groupBy`** the list renders whole and drops its pager — an A–Z book cut
  across numbered pages stops being a book. Only opt in when the data is
  lookup-sized. Sections are ordered by heading, so the book still reads A–Z after
  the user sorts a column; headings starting with a symbol file last.
- **Without `groupBy`** the list still paginates. There is no structure to
  preserve, and an unbounded record set is not a page shape.

Do not hand-roll `mobileRow.leading` to show a serial number — `DataTable` already
renders a muted S/N bubble there when `showRowNumbers` is on (it is by default).
Colour in that slot means *identity*: an avatar, or initials in `bg-primary/10` as
its fallback. A row number is a property of the current sort, not of the record,
and putting the brand accent on it spends the loudest thing on the row on the one
value that carries no information — while the status badge beside it whispers.

The view toggle reads **List · Cards · Table**, and all three stay distinct at
every width: Table renders the real table on a phone too, scrolling horizontally,
rather than quietly swapping itself for the row list. `hideOnMobile` is ignored in
that mode — it exists to squeeze a table that is a page's *only* mobile rendering,
and picking Table when a List mode is sitting next to it is an explicit request to
see the columns.

Pages that supply `mobileRow` **without** `contactsView` are unchanged: there is no
separate List mode there, so the row list still stands in for the table below `md`.

`defaultViewMode` takes either a mode or `{ mobile, desktop }`. Records pages with
many columns want `{ mobile: "contacts", desktop: "list" }` — the row list where
the columns will not fit, the table where they will. A lookup page passes a plain
`"contacts"` and keeps its list at both. It is only the opening view: once the
reader picks from the toggle, their choice holds across resizes. Mirror the choice
in `loading.tsx` with `list="responsive"` (or `list="contacts"`).

`{ mobile: "contacts", desktop: "list" }` is resolved in **CSS**, not JS: both
shapes are rendered and media queries pick, so the right one is in the first paint
(`useIsMobile` only reports after the first effect, which would flash the desktop
table on a phone). The toggle's pressed state is resolved the same way. This
applies only while the reader has made no choice; after that a single mode
renders. Any other pair falls back to the JS breakpoint.

`contactsView` removes the desktop table from view, and `expandable` never fires in
it. Anything the expandable row used to show — an attachment link, a timeline, a
"returned for correction" instruction — has to move into `detail.fields`, or it is
simply gone. Fields that open something take `href`, not `copyable`.

### Stats parity

`statBadges` and `stats` are one metric set rendered twice, not two sets. A metric
that is conditional in one must be conditional in the other, or a viewer sees a
different page on either side of `md` — typically a "0" card for a role they do not
hold. Same rule for icons: pick one per metric and use it in both.

### Route `loading.tsx` skeletons

Loading routes must mirror the real page shape — including the new one.
`TablePageSkeleton` takes `statBadges`, `spacing="tight"`, `inlineActions` and
`list="contacts"` (with `groups`) so a page using those props does not visibly
reflow on mount. Use the canonical skeletons from
`@/components/skeletons`:

- `TablePageSkeleton` for `DataTablePage` routes
- `DashboardSkeleton` for dashboard and overview routes
- `CardGridPageSkeleton` for module landing pages and card-grid pages
- `DetailPageSkeleton` for detail/view pages
- `FormPageSkeleton` for create/edit form pages

Do not hand-roll a single bar or generic card placeholder for a table page. Match
the expected stats count, tabs, filter count, action count, and table density.

### UI audit tooling

- Run `npm run ui:audit` after table, skeleton, or page-shell changes.
- Run `npm run ui:ensure-loading` only when intentionally adding missing route
  loading files.
- Review generated loading files manually before committing them.
- UI audit scripts must normalize Windows paths with `toPosix()` before route
  matching.

---

## Notification System

Every feature that produces events the user should see must write to the `notifications` table via the `create_notification` RPC. Omitting this causes silent failures — always wire it up alongside the feature.

### How to call

Use the Supabase client (user context is fine — the function is `SECURITY DEFINER`):

```ts
try {
  await supabase.rpc("create_notification", {
    p_user_id: targetUserId,      // who sees this notification
    p_type: "approval_granted",   // must be in the allowed list below
    p_category: "approvals",      // must match a UI tab key — see table below
    p_title: "...",
    p_message: "...",
    p_priority: "normal",         // low | normal | high | urgent
    p_link_url: "/your-feature",  // page the user navigates to
    p_actor_id: actorId,          // who triggered it (optional)
    p_entity_type: "my_record",   // for grouping/dedup (optional)
    p_entity_id: record.id,       // (optional)
  })
} catch (err) {
  log.error({ err: String(err) }, "notification failed")
}
```

Always wrap in `try/catch`. Notification failure must never crash the parent operation.

### Allowed `p_type` values

`task_assigned` | `task_updated` | `task_completed` | `mention` | `feedback` |
`asset_assigned` | `asset_transfer_outgoing` | `asset_transfer_incoming` | `asset_returned` |
`asset_status_alert` | `asset_status_fixed` | `system_restored` |
`approval_request` | `approval_granted` | `approval_rejected` | `announcement` | `system`

### Allowed `p_category` values and their UI tabs

| `p_category` | Tab shown in `/notifications` |
|---|---|
| `approvals` | Approvals |
| `tasks` | Tasks |
| `assets` | Assets |
| `feedback` | Feedback |
| `mentions` | Mentions |
| `meetings` | Meetings |
| `communications` | Communications |
| `reports` | Reports |
| `system` | All only (no dedicated tab) |

### Adding a new category

If your feature needs a category not in the table above, you **must** also:

1. Add a tab entry to `app/(app)/notifications/notification-content.tsx` — both the `tabs` array and the `counts` object.
2. Add a row to `notification_delivery_policies` in a new migration (update the `CHECK` constraint first if it restricts `notification_key`).

### `admin/notifications` is a separate system

`app/admin/notifications/page.tsx` is a real-time aggregation dashboard that queries operational tables dynamically. It does **not** read from the `notifications` table. Do not conflate the two.

---

## Email and In-App Notification Parity — Mandatory

Every API route or lib function that dispatches an outgoing email to a named user **must also** create an in-app notification for that same user. Sending email without a matching in-app notification is a silent failure — recipients miss events they should see inside the ERP.

### The rule

Whenever you call any of the following email helpers, also call `create_notification` (or `notifyUsers` for the leave system) for every named recipient:

| Email helper | Location |
|---|---|
| `sendLeaveWorkflowEmail` | `lib/leave-mailer.ts` — use `notifyUsers` from `lib/hr/leave-workflow.ts` instead; it handles both channels |
| `sendHelpDeskMail` | `lib/help-desk/mailer.ts` |
| `sendCorrespondenceDecisionEmail` | `lib/correspondence/mailer.ts` |
| `sendExitNotificationEmail` | `lib/hr/exit-mailer.ts` |
| `sendNotificationEmail` / `sendNotificationEmailWithRetry` | `lib/notifications/email-gateway.ts` |

### Event → notification type mapping

| Event | `p_type` | `p_category` |
|---|---|---|
| Approval needed (next approver) | `approval_request` | `approvals` |
| Approved (requester notified) | `approval_granted` | `approvals` |
| Rejected (requester notified) | `approval_rejected` | `approvals` |
| Task assigned | `task_assigned` | `tasks` |
| Task completed / resolved | `task_completed` | `tasks` |
| Asset assigned | `asset_assigned` | `assets` |
| SLA reminder / breach / lapsed | `system` | `system` |
| Broadcast / onboarding / announcement | `announcement` | `system` |

### Required pattern

```ts
// 1. Send email (in try/catch so it never crashes the operation)
try {
  await sendSomeEmail({ to: [recipientEmail], ... })
} catch (err) {
  log.error({ err: String(err) }, "email failed")
}

// 2. Create matching in-app notification (also in try/catch)
try {
  await supabase.rpc("create_notification", {
    p_user_id: recipientUserId,
    p_type: "approval_granted",   // use the correct type from the table above
    p_category: "approvals",
    p_title: "...",
    p_message: "...",
    p_priority: "normal",
    p_link_url: "/your-feature",
    p_actor_id: actorId,
    p_entity_type: "...",
    p_entity_id: record.id,
  })
} catch (err) {
  log.error({ err: String(err) }, "notification failed")
}
```

Always wrap both calls in separate `try/catch` blocks. Notification failure must never crash the parent operation, and email failure must not prevent the notification.

### Supabase Edge Functions — same parity rule applies

Edge functions under `supabase/functions/` run outside the Next.js process, but they are created with a **service-role** Supabase client, so they can and **must** insert the matching in-app notification directly into the `notifications` table after sending an email. The rule is identical: no user-facing email without an in-app notification.

Insert directly (the `create_notification` RPC is also callable, but a plain insert is simplest from Deno):

```ts
const { error: notifyError } = await supabase.from("notifications").insert({
  user_id: profile.id,          // the ERP user the email went to
  type: "announcement",          // type from the mapping table above
  category: "system",
  priority: "normal",
  title: "...",
  message: "...",
  link_url: null,
})
if (notifyError) console.error(`[fn] in-app notification failed: ${notifyError.message}`)
```

Wrap it so a notification failure never aborts the email loop. Reference implementations: `send-birthday-emails` (per-recipient inside the send loop) and the exit flow in `app/api/v1/hr/employees/[employeeId]/exit-notification/route.ts`.

When the email targets an external address that maps to a person, resolve their ERP `user_id` (e.g. via `profiles`) and notify that id.

**Never hardcode a person's name as the signatory in any email body or footer.** Choose by send type:
- **Automated/system mail** (cron, triggers — e.g. birthday, meeting-reminder fallback, IT notifications): use a generic **department** signature with no individual ("Admin & HR Department", "IT & Communications"). No person means nothing goes stale when someone exits. See `send-birthday-emails`.
- **Admin-composed mail** (broadcasts, meeting reminders, weekly summaries, communications): let the admin **select** the "Prepared by" person per send (see `BroadcastForm`/`MeetingReminderForm`), or resolve it live from the DB so an exited employee is never credited (see `lib/hr/exit-mailer.ts`).

Remaining edge functions still email-only and pending parity work: `send-weekly-report`, `send-meeting-reminder`, `send-communications-mail` (these already insert some notifications — verify per-recipient coverage).

### Leave system — use `notifyUsers`, not raw RPC

For any leave workflow event, always use `notifyUsers` from `lib/hr/leave-workflow.ts`. It handles delivery policy resolution, channel eligibility, and both email and in-app in one call. Pass `emailEvent` so the correct `p_type` is set per the mapping above.

## Email Identity, Routing, and Subjects — Single Source of Truth

**One sender for all automated mail.** Every automated notification sends as
**`ACOB Lighting Technology Limited <notifications@acoblighting.com>`**. There are
no per-subsystem display names — they all sent from the same address anyway, which
is what mail clients thread, filter, and score, so the names bought nothing and
forced a naming argument for every new subsystem.

**Never hardcode a "From", Reply-To, or List-Id as a string literal.** Each runtime
has exactly one place for them:

- **Next app** (`lib/`, `app/api/`): `ORG_EMAIL_SENDERS.system` and `ORG_MAIL_ROUTING`
  in `lib/org-config.ts`.
- **Edge functions** (`supabase/functions/`, Deno — cannot import `lib/`):
  `EDGE_SENDERS.system` and `EDGE_MAIL_ROUTING` in `supabase/functions/_shared/senders.ts`.

Call sites spread one routing entry so the pair can never disagree:

```ts
await sendNotificationEmailsIndividuallyWithRetry({
  from: ORG_EMAIL_SENDERS.system,
  ...ORG_MAIL_ROUTING["Leave"],   // supplies replyTo + listId together
  to: recipients,
  subject,
  html,
})
```

**Reply-To must be a monitored mailbox** — `ict@`, `hradmin@`, `accounts@`. A Reply-To
nobody opens is worse than none, because senders assume they were heard. Never point
it at a named individual unless the role genuinely has no shared mailbox (only
Correspondence does today).

**List-Id** (RFC 2919, e.g. `<leave.acoblighting.com>`) is invisible to readers and
exists so recipients can filter a stream (`list:leave.acoblighting.com` in Gmail)
without the subject carrying a `[Leave]`-style prefix. Add one for every new module.

**The only sender that varies is `send-communications-mail`** — real correspondence
written by a person, sent as `ACOB {department}` via `edgeDepartmentSenderBare()`,
replying to that department's lead resolved per send.

### Subject Line Standard (Mandatory)

> **`{Module noun} {what happened} — {reference}`**

1. **Lead with the module noun** — `Asset`, `Leave Request`, `Help Desk Ticket`,
   `Payment`, `Meeting`, `Attendance`, `Staff Exit`. The sender is generic, so the
   subject is the only thing identifying the stream. Non-negotiable.
2. **Then the event in plain words** — past tense for what happened (`Assigned`,
   `Approved`, `Returned`), forward-looking for what is needed (`Awaiting Your
   Approval`, `Due Today`).
3. **Then the reference after ` — ` (em dash), always last.** One separator. Never a
   colon, never a hyphen, never both.
4. **No prefixes, no brackets, no company name.** Not `System:`, not `[Assets]`, not
   `— ACOB Lighting Technology Limited` — the From line already says it.
5. **Meaning within ~45 characters** before the reference; that is roughly what a
   phone shows.
6. **Nothing dynamic in the opening words**, so a sorted inbox groups naturally.

Conforming examples: `Asset Assigned — ACOB/HQ/DSKST/2023/005`,
`Leave Request Approved — LR-0042`, `Payment Overdue — Generator Servicing`,
`Help Desk Ticket Created — HD-0117`, `Staff Exit Notification — Jane Doe`.

Birthday mail is the single deliberate exception (`Happy Birthday from ACOB
Lighting!`) — it is meant to read as human, not as a system record.

`withSubjectPrefix()` in both runtimes is intentionally a pass-through. Bracket
prefixes were considered and rejected: they cost ~9 characters of mobile preview on
every mail to duplicate what rule 1 already guarantees. Filtering is `List-Id`'s job.

Edge functions are excluded from `tsc`/`eslint`; validate with
`deno check --node-modules-dir=auto supabase/functions/*/index.ts` and **smoke-test any
sender or subject change on deploy**.

## Email Template Standard — Header, Footer, and Dark-Mode Lock (Mandatory)

**Every email sent from this ERP must use the branded ACOB shell**: black header bar with the ACOB logo, green (`#16a34a`) top/bottom borders, a white 600–680px content wrapper, and a matching black footer with the company name + subsystem line + automated-notice text. Do not invent a one-off lighter/plainer template — copy the shell from an existing sender (`supabase/functions/_shared/artifact-email.ts` or `supabase/functions/send-meeting-reminder/index.ts` are the reference implementations) and only swap the body content.

**The header/footer black bars must be dark-mode-locked**, or Gmail/Outlook dark mode will invert them to a white bar with unreadable text. Every black header/footer `<table>` cell must carry all of the following together — no partial subset:

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000"
  style="background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;border-top:3px solid #16a34a;border-bottom:3px solid #16a34a;mso-line-height-rule:exactly;">
  <tr><td align="center" style="padding:20px 0;background:#000000 !important;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000) !important;">
    <!-- logo or footer text -->
  </td></tr>
</table>
```

The `background-image:linear-gradient(color,color) !important` is the load-bearing part — Gmail's dark-mode algorithm inverts flat `background-color` values but leaves elements with a `background-image` alone. `background:` alone (as used in `_shared/artifact-email.ts` before this was fixed) is **not sufficient** and will still get inverted in Gmail dark mode.

Before adding a new email template (Next.js `lib/email-templates/`, `lib/*-mailer.ts`, or a Supabase edge function), verify the header/footer table matches this exact pattern. If you copy an existing template as a starting point, grep it for `linear-gradient` first — `send-birthday-emails`, `send-communications-mail`, `send-email-notification`, `send-weekly-report`, and `send-meeting-reminder` already have it correctly.

## Email Delivery Standard — Loop Over Recipients Individually (Mandatory)

**Never send a system/automated email to multiple recipients in a single `to` array/list.** Doing this puts all recipients in the email header's `to` field, exposing everyone's email address to all other recipients (acting like an unintentional public "CC").

- **Standard Policy**: If an email needs to go to multiple people, always loop over the recipient list and call the email dispatch helper (`sendEmail` or equivalent) individually for each recipient, so that each person receives a separate email where they are the sole recipient.
- **Reference Implementations**:
  - `send-meeting-reminder` (loops through `recipients` individually).
  - `send-attendance-daily-report` (loops through `recipientEmails` individually).
  - `send-weekly-report` (uses `processRecipientBatch` to send to each recipient individually).
  - `send-communications-mail` (uses `processRecipientBatch` to send to each recipient individually).

