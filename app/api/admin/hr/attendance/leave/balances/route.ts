import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

const log = logger("admin-hr-attendance-leave-balances")
export const dynamic = "force-dynamic"

/**
 * Current-year leave balances for one employee, read with the service-role client so it
 * works for every admin tier (developer / super_admin / lead) — the shared
 * /api/hr/leave/balances goes through RLS, which only grants cross-user reads to the exact
 * `admin` role. Used by the Attendance Manager's leave tab to populate types + remaining.
 */
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-balances:${getClientId(request)}`, { limit: 60, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const userId = String(request.nextUrl.searchParams.get("user_id") || "")
    if (!userId) return NextResponse.json({ error: "user_id is required" }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Scope-check the target employee's department.
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      const { data: prof } = await dataClient
        .from("profiles")
        .select("department")
        .eq("id", userId)
        .maybeSingle<{ department: string | null }>()
      if (!prof || !depts.includes(prof.department || "")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    const year = new Date().getUTCFullYear()
    const { data, error } = await dataClient
      .from("leave_balances")
      .select(
        "leave_type_id, allocated_days, used_days, carry_forward_days, balance_days, leave_type:leave_types!leave_balances_leave_type_id_fkey(id, name)"
      )
      .eq("user_id", userId)
      .eq("year", year)
      .order("leave_type_id")

    if (error) {
      log.error({ err: String(error) }, "Failed to fetch leave balances")
      return NextResponse.json({ error: "Failed to fetch balances" }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/leave/balances")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
