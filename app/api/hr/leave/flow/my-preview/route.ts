import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildResolvedRouteSnapshot, classifyRequesterKind } from "@/lib/hr/leave-routing"
import { logger } from "@/lib/logger"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"

const log = logger("hr-leave-flow-my-preview")
const PLACEHOLDER_RELIEVER_ID = "00000000-0000-4000-8000-000000000000"

function roleLabel(roleCode: string) {
  switch (roleCode) {
    case "reliever":
      return "Reliever"
    case "department_lead":
      return "Department Lead"
    case "admin_hr_lead":
      return "Admin & HR Lead"
    case "hcs":
      return "HCS"
    case "md":
      return "MD"
    default:
      return roleCode.replaceAll("_", " ")
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const dataClient = getServiceRoleClientOrFallback(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("id, department, department_id, is_department_lead, lead_departments")
      .eq("id", user.id)
      .single()

    if (requesterError || !requester) {
      return NextResponse.json({ error: "Requester profile not found" }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const relieverId = searchParams.get("reliever_id") || PLACEHOLDER_RELIEVER_ID

    const requesterKind = classifyRequesterKind(requester)
    const snapshot = await buildResolvedRouteSnapshot({
      supabase: dataClient,
      requester,
      requesterId: requester.id,
      requesterKind,
      relieverId,
    })

    const stages = snapshot.map((stage) => ({
      stage_code: stage.stage_code,
      role_code: stage.approver_role_code,
      label: roleLabel(stage.approver_role_code),
    }))

    return NextResponse.json({
      data: {
        requester_kind: requesterKind,
        stages,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/flow/my-preview:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}
