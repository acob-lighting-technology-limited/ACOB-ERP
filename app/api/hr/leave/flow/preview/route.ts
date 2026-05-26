import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { buildResolvedRouteSnapshot, classifyRequesterKind } from "@/lib/hr/leave-routing"
import { logger } from "@/lib/logger"

const log = logger("hr-leave-flow-preview")
export const dynamic = "force-dynamic"

function canViewFlow(role?: string | null) {
  return ["developer", "super_admin", "admin"].includes(role || "")
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single()
    if (!canViewFlow(profile?.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

    const { searchParams } = request.nextUrl
    const targetUserId = searchParams.get("user_id")
    const relieverId = searchParams.get("reliever_id")

    if (!targetUserId || !relieverId) {
      return NextResponse.json({ error: "user_id and reliever_id are required" }, { status: 400 })
    }

    const { data: requester, error: requesterError } = await supabase
      .from("profiles")
      .select("id, department, department_id, is_department_lead, lead_departments")
      .eq("id", targetUserId)
      .single()

    if (requesterError || !requester) {
      return NextResponse.json({ error: "Requester not found" }, { status: 404 })
    }

    const requesterKind = classifyRequesterKind(requester)
    const snapshot = await buildResolvedRouteSnapshot({
      supabase,
      requester,
      requesterId: requester.id,
      requesterKind,
      relieverId,
    })

    return NextResponse.json({
      data: {
        requester_kind: requesterKind,
        route_snapshot: snapshot,
      },
    })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/hr/leave/flow/preview:")
    return NextResponse.json({ error: error instanceof Error ? error.message : "An error occurred" }, { status: 500 })
  }
}
