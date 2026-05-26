import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { logger } from "@/lib/logger"
import { getRequestScope } from "@/lib/admin/api-scope"

const log = logger("hr-leave-payroll-feed")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const payrollScope = await getRequestScope()
    if (!payrollScope?.isAdminLike || payrollScope.scopeMode === "lead") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = request.nextUrl
    const from = searchParams.get("from")
    const to = searchParams.get("to")

    let query = supabase
      .from("leave_requests")
      .select(
        `
        id,
        user_id,
        leave_type_id,
        start_date,
        end_date,
        resume_date,
        days_count,
        status,
        approval_stage,
        approved_at,
        updated_at,
        user:profiles!leave_requests_user_id_fkey(id, full_name, company_email),
        leave_type:leave_types!leave_requests_leave_type_id_fkey(id, name, code)
      `
      )
      .in("status", ["approved", "cancelled"])
      .order("updated_at", { ascending: false })

    if (from) query = query.gte("start_date", from)
    if (to) query = query.lte("end_date", to)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: "Failed to fetch payroll leave feed" }, { status: 500 })
    }

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/payroll-feed:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
