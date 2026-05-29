import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { resolveAdminScope, expandDepartmentScopeForQuery, type AdminScope } from "@/lib/admin/rbac"
import type { DeptScope } from "@/lib/dept/scope"
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
    adminDomains: [],
    scopeMode: "lead",
  }
}

/**
 * Reads the AdminScope injected by middleware (x-admin-scope header).
 * This is the PRIMARY way for API route handlers to get scope —
 * no extra DB round-trip.
 *
 * Falls back to x-dept-scope (injected for /dept/ and /api/dept/ paths),
 * synthesising a compatible AdminScope so existing admin API handlers work
 * for dept leads without any changes.
 *
 * Falls back to resolveApiAdminScope() if both headers are absent (e.g. local
 * dev without middleware, or uncovered paths).
 */
export async function getRequestScope(): Promise<AdminScope | null> {
  try {
    const h = await headers()
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
    adminDomains: [],
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
