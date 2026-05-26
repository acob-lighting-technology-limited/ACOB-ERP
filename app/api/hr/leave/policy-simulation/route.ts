import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { evaluateLeaveEligibility, getLeavePolicy } from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("hr-leave-policy-simulation")
export const dynamic = "force-dynamic"

type LeaveTypeSummary = {
  id: string
  name?: string | null
  code?: string | null
  max_days?: number | null
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: requester } = await supabase
      .from("profiles")
      .select(
        "id, full_name, company_email, gender, employment_date, employment_type, marital_status, has_children, pregnancy_status"
      )
      .eq("id", user.id)
      .single()

    if (!requester) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

    const { searchParams } = request.nextUrl
    const daysCount = Number(searchParams.get("days") || "1")
    const startDate = searchParams.get("start_date") || toLocalISODate()

    const { data: leaveTypes } = await supabase.from("leave_types").select("id, name, code, max_days").order("name")

    const simulations = await Promise.all(
      ((leaveTypes || []) as LeaveTypeSummary[]).map(async (leaveType) => {
        const policy = await getLeavePolicy(supabase, leaveType.id)
        const result = await evaluateLeaveEligibility({
          supabase,
          policy,
          requesterProfile: requester,
          leaveType,
          startDate,
          daysCount,
        })

        return {
          leave_type: leaveType,
          policy,
          eligibility_status: result.status,
          eligibility_reason: result.reason,
          required_documents: result.requiredDocuments,
          missing_documents: result.missingDocuments,
        }
      })
    )

    return NextResponse.json({
      employee: {
        id: requester.id,
        full_name: requester.full_name,
        company_email: requester.company_email,
      },
      data: simulations,
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/policy-simulation:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}
