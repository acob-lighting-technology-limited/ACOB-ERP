# Repository Agent Standards

This file defines the minimum engineering standards that AI agents must follow when working in this repository. These rules are intended to prevent lint debt, weak typing, build regressions, and workflow bypasses.

## Delivery Standard

Do not treat a task as complete until all required checks pass:

- `npx eslint . --ext .ts,.tsx`
- `npx tsc --noEmit`
<!-- - `npm run build` -->

If a change cannot satisfy all three checks, report the blocker clearly instead of claiming completion.

## Git and Hook Policy

- Never use `git commit --no-verify`.
- Never use `git push --no-verify`.
- Do not bypass failing hooks. Fix the underlying issue.
- Pre-commit must pass `lint-staged` including ESLint and Prettier.
- Pre-push must pass `npm run build`.
- Confirm the build passes locally before pushing.

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
- ❌ Inline search or filter state in a page — all handled by `DataTable`
- ❌ `<Loader2>` spinner for table loading — skeletons are automatic
- ❌ Fewer than 2 filter options on any table page
- ❌ A table page without stats cards
- ❌ A table page without `DataTablePage` as the root wrapper

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

### Known exception — Supabase Edge Functions

Edge functions under `supabase/functions/` run outside the Next.js process. They currently send emails only (`send-weekly-report`, `send-meeting-reminder`, `send-communications-mail`). Adding in-app notifications from edge functions requires calling the Supabase REST API directly with the service-role key — do not attempt this inside a Next.js route handler. Track as a separate task and document when complete.

### Leave system — use `notifyUsers`, not raw RPC

For any leave workflow event, always use `notifyUsers` from `lib/hr/leave-workflow.ts`. It handles delivery policy resolution, channel eligibility, and both email and in-app in one call. Pass `emailEvent` so the correct `p_type` is set per the mapping above.
