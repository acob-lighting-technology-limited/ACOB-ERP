import { NextResponse } from "next/server"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getRequestScope } from "@/lib/admin/api-scope"
import { buildAccessContextV2 } from "@/lib/admin/policy-v2"
import { enforceRouteAccessV2 } from "@/lib/admin/api-guard-v2"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"

const log = logger("admin-employees-list")

export const dynamic = "force-dynamic"

/**
 * GET /api/admin/employees
 * Returns all profiles visible to the current user based on their AdminScope.
 * - Super admins / admins in global mode → full list
 * - Leads / admins in lead mode → only their managed departments
 */
export async function GET() {
  const scope = await getRequestScope()
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const context = buildAccessContextV2(scope)

  const routeAccess = enforceRouteAccessV2(context, "hr.main")
  if (!routeAccess.ok) return routeAccess.response

  const supabase = await createServerClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  let query = dataClient.from("profiles").select("*").order("last_name", { ascending: true })

  const scopedDepts =
    routeAccess.dataScope === "all" ? null : routeAccess.dataScope === "none" ? [] : routeAccess.dataScope

  if (scopedDepts !== null) {
    // Scoped lead or admin in lead mode
    if (scopedDepts.length === 0) {
      log.warn({ userId: scope.userId }, "Lead has no managed departments; returning empty employee list")
      return NextResponse.json({ data: [] })
    }
    // Expand aliases and filter
    const expandedDepts = expandDepartmentScopeForQuery(scopedDepts)
    if (expandedDepts.length > 0) {
      query = query.in("department", expandedDepts)
    }
  }
  // else: null = global view, no filter

  const { data, error } = await query
  if (error) {
    log.error({ err: error.message }, "Failed to fetch employees")
    return NextResponse.json({ error: "Failed to fetch employees" }, { status: 500 })
  }

  return NextResponse.json({ data: data || [] })
}
