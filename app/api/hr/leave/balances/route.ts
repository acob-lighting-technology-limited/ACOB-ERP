import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getRequestScope } from "@/lib/admin/api-scope"
import { getLeaveEntitlements } from "@/lib/hr/leave-entitlement"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-balances")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const userId = searchParams.get("user_id") || user.id

    if (userId !== user.id) {
      const scope = await getRequestScope()
      if (!scope?.isAdminLike) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Balances are derived from the leave type's allowance minus the employee's own requests —
    // see lib/hr/leave-entitlement.ts. The response keeps the field names of the old stored
    // rows (allocated_days / used_days / balance_days) so existing callers are unaffected.
    const year = new Date().getUTCFullYear()
    const entitlements = await getLeaveEntitlements(supabase, userId, { year })

    const data = entitlements.map((e) => ({
      user_id: userId,
      leave_type_id: e.leaveTypeId,
      year,
      allocated_days: e.entitlementDays,
      used_days: e.usedDays,
      pending_days: e.pendingDays,
      carry_forward_days: 0,
      balance_days: e.remainingDays,
      needs_evidence: e.needsEvidence,
      leave_type: { id: e.leaveTypeId, name: e.name, code: e.code, max_days: e.entitlementDays },
    }))

    return NextResponse.json({ data })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/balances:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
