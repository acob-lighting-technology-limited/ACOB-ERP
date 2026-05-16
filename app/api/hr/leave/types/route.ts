import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { evaluateLeaveEligibility, getLeavePolicy } from "@/lib/hr/leave-workflow"
import { logger } from "@/lib/logger"
import { toLocalISODate } from "@/lib/utils/date"

const log = logger("hr-leave-types")
export const dynamic = "force-dynamic"

type LeaveTypeSummary = {
  id: string
  name?: string | null
  code?: string | null
  max_days?: number | null
}

export async function GET(_: NextRequest) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [{ data: leaveTypes, error }, { data: profile }] = await Promise.all([
      supabase.from("leave_types").select("*").order("name"),
      supabase
        .from("profiles")
        .select("id, gender, employment_date, employment_type, marital_status, has_children, pregnancy_status")
        .eq("id", user.id)
        .single(),
    ])
    const requesterProfile = profile || {
      id: user.id,
      gender: "unspecified",
      employment_date: null,
      employment_type: null,
      marital_status: "unspecified",
      has_children: false,
      pregnancy_status: "unspecified",
    }

    if (error) {
      log.error({ err: String(error) }, "Error fetching leave types:")
      return NextResponse.json({ error: "Failed to fetch leave types" }, { status: 500 })
    }

    const enriched = await Promise.all(
      ((leaveTypes || []) as LeaveTypeSummary[]).map(async (leaveType) => {
        const policy = await getLeavePolicy(supabase, leaveType.id)
        const evaluation = await evaluateLeaveEligibility({
          supabase,
          policy,
          requesterProfile,
          leaveType,
          startDate: toLocalISODate(),
          daysCount: 1,
        })

        return {
          ...leaveType,
          policy,
          eligibility_status: evaluation.status,
          eligibility_reason: evaluation.reason,
          required_documents: evaluation.requiredDocuments,
          missing_documents: evaluation.missingDocuments,
        }
      })
    )

    return NextResponse.json({ data: enriched })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/types:")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
