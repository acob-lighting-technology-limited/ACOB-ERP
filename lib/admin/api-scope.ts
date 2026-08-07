import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, expandDepartmentScopeForQuery, type AdminScope } from "@/lib/admin/rbac"
import { resolveDeptScope, type DeptScope } from "@/lib/dept/scope"
import { logger } from "@/lib/logger"

const log = logger("admin-api-scope")

export type { AdminScope }

/**
 * Synthesises an AdminScope from a DeptScope so that existing admin API
 * route handlers work for dept leads without modification.
 *
 * The resulting scope has scopeMode "lead" and managedDepartments scoped to
 * the single dept the lead owns, which makes getScopedDepartments() return
 * the correct department filter automatically.
 */
function adminScopeFromDeptScope(deptScope: DeptScope): AdminScope {
  return {
    userId: deptScope.userId,
    role: deptScope.role,
    department: deptScope.deptName,
    departmentId: deptScope.deptId,
    officeLocation: null,
    isDepartmentLead: true,
    leadDepartments: [deptScope.deptName],
    managedDepartments: [deptScope.deptName],
    managedDepartmentIds: [deptScope.deptId],
    managedOffices: [],
    isAdminLike: deptScope.isAdminLike,
    adminRoutes: [],
    scopeMode: "lead",
  }
}

/**
 * Extracts the department console the caller is sitting in, if any.
 *
 * Prefers the explicit x-dept-context header set by apiFetch(); falls back to
 * parsing the Referer, which the browser sends in full for same-origin requests
 * under our strict-origin-when-cross-origin policy. The fallback covers the
 * call sites that still use raw fetch() instead of apiFetch().
 *
 * The returned id is untrusted input — callers MUST re-resolve lead membership
 * against the database before granting anything on the strength of it.
 */
export function readDeptContextId(h: Headers): string | null {
  const explicit = h.get("x-dept-context")?.trim()
  if (explicit) return explicit

  // Referer on a *navigation* is the page you came FROM, not the page being
  // rendered — using it there would scope an /admin page to the dept console
  // you just navigated away from. Skip both full document loads and Next.js
  // client-side RSC navigations (which look like XHR but are navigations).
  // Only plain fetch/XHR remains, where Referer is the page making the call.
  if (h.get("sec-fetch-dest") === "document") return null
  if (h.get("rsc") === "1" || h.has("next-router-prefetch") || h.has("next-router-state-tree")) return null

  const referer = h.get("referer")
  if (!referer) return null
  try {
    const match = new URL(referer).pathname.match(/^\/dept\/([^/]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

/**
 * Resolves the caller's AdminScope for API route handlers.
 *
 * Resolution order:
 *  1. Department console context (x-dept-context / Referer) — narrows to the
 *     single department whose console the caller is in, re-verified against
 *     the DB. Takes precedence so the dept surface never serves global data.
 *  2. The AdminScope injected by middleware (x-admin-scope) — no extra DB hit.
 *  3. x-dept-scope, injected for /dept/ and /api/dept/ paths.
 *  4. resolveApiAdminScope(), for paths middleware does not cover.
 */
export async function getRequestScope(): Promise<AdminScope | null> {
  try {
    const h = await headers()

    // Department console takes precedence over any global admin scope. Dept
    // pages reuse the admin view components, so without this an admin who also
    // leads a department would be served every department's data while sitting
    // in one department's console. Membership is re-resolved from the DB below,
    // so the (spoofable) dept id can only ever narrow access, never widen it.
    const deptContextId = readDeptContextId(h)
    if (deptContextId) {
      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return null
      const deptScope = await resolveDeptScope(supabase, user.id, deptContextId)
      // Not a lead of this department — deny rather than falling back to a
      // wider scope, which is what leaked data in the first place.
      return deptScope ? adminScopeFromDeptScope(deptScope) : null
    }

    const raw = h.get("x-admin-scope")
    if (raw) {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf-8")) as AdminScope
    }
    // Fallback: dept scope injected for /dept/ and /api/dept/ paths
    const deptRaw = h.get("x-dept-scope")
    if (deptRaw) {
      const deptScope = JSON.parse(Buffer.from(deptRaw, "base64").toString("utf-8")) as DeptScope
      if (deptScope?.userId) return adminScopeFromDeptScope(deptScope)
    }
  } catch {
    // Header absent or malformed — fall through to DB resolution
  }
  return resolveApiAdminScope()
}

/**
 * Resolves the current authenticated user's AdminScope for use in API route
 * handlers. Returns null if the user is unauthenticated or has no admin access.
 * Prefer getRequestScope() in new code — it reads from the middleware header first.
 *
 * Falls back to a synthesised dept-lead AdminScope for pure leads who no longer
 * enter /admin (since Phase 6) but still call /api/hr/ routes from the /dept/ surface.
 */
export async function resolveApiAdminScope(): Promise<AdminScope | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  const scope = await resolveAdminScope(supabase, user.id)
  if (scope) return scope

  // Fallback for pure dept leads: synthesise a scoped AdminScope so they can
  // still call /api/hr/ and /api/admin/ routes from the /dept/[dept_id]/ surface.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_department_lead, lead_departments, department, department_id")
    .eq("id", user.id)
    .single<{
      role: string | null
      is_department_lead: boolean
      lead_departments: string[] | null
      department: string | null
      department_id: string | null
    }>()

  if (!profile?.is_department_lead) return null

  const leadDepts: string[] = Array.isArray(profile.lead_departments)
    ? profile.lead_departments
    : profile.department
      ? [profile.department]
      : []

  if (leadDepts.length === 0) return null

  return {
    userId: user.id,
    role: (profile.role ?? "employee") as AdminScope["role"],
    department: profile.department ?? null,
    departmentId: profile.department_id ?? null,
    officeLocation: null,
    isDepartmentLead: true,
    leadDepartments: leadDepts,
    managedDepartments: leadDepts,
    managedDepartmentIds: profile.department_id ? [profile.department_id] : [],
    managedOffices: [],
    isAdminLike: false,
    adminRoutes: [],
    scopeMode: "lead",
  }
}

/**
 * Resolves the AdminScope and returns a 401/403 NextResponse if the user lacks
 * access. Use this at the start of admin API handlers.
 * Uses getRequestScope() internally — reads the middleware header first.
 *
 * @returns `{ scope, supabase }` on success, or a NextResponse error to return early.
 */
export async function requireApiAdminScope(): Promise<
  | { ok: true; scope: AdminScope; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  // Try header first, fall back to DB
  const scope = await getRequestScope()
  if (!scope) {
    log.warn({ userId: user.id }, "User has no admin scope")
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return { ok: true, scope, supabase }
}

/**
 * Returns an array of department name strings to filter by for a given scope,
 * or null if no department filtering should be applied (i.e. the user can see
 * all departments).
 *
 * Expands aliases (e.g. "Finance" → "Accounts") automatically.
 */
export function getScopedDepartments(scope: AdminScope): string[] | null {
  // Admin-like roles in global mode see everything
  if (scope.isAdminLike && scope.scopeMode !== "lead") return null
  // Non-lead employees should not reach admin APIs, but guard anyway
  if (!scope.isDepartmentLead && !scope.isAdminLike) return []
  // Lead (or admin in lead mode) — return managed departments with aliases
  if (scope.managedDepartments.length === 0) return []
  return expandDepartmentScopeForQuery(scope.managedDepartments)
}

/**
 * Returns an array of department ID strings to filter by.
 * Returns null if unrestricted; empty array if the lead has no mapped IDs.
 */
export function getScopedDepartmentIds(scope: AdminScope): string[] | null {
  if (scope.isAdminLike && scope.scopeMode !== "lead") return null
  if (!scope.isDepartmentLead && !scope.isAdminLike) return []
  return scope.managedDepartmentIds.length > 0 ? scope.managedDepartmentIds : []
}
