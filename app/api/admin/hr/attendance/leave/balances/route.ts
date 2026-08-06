import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getLeaveEntitlements } from "@/lib/hr/leave-entitlement"

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

    // Entitlement is derived from the leave type's allowance minus this employee's own requests,
    // and already filtered to the types they are eligible for — see lib/hr/leave-entitlement.ts.
    const year = new Date().getUTCFullYear()
    const entitlements = await getLeaveEntitlements(dataClient, userId, { year })

    const data = entitlements.map((e) => ({
      leave_type_id: e.leaveTypeId,
      leave_type: { id: e.leaveTypeId, name: e.name, max_days: e.entitlementDays },
      eligibility_status: e.needsEvidence ? "missing_evidence" : "eligible",
      has_balance: true,
      allocated_days: e.entitlementDays,
      used_days: e.usedDays,
      pending_days: e.pendingDays,
      carry_forward_days: 0,
      balance_days: e.remainingDays,
    }))

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/leave/balances")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
