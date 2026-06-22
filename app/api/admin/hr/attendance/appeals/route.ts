import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { logger } from "@/lib/logger"

const log = logger("admin-hr-attendance-appeals")
export const dynamic = "force-dynamic"

type AppealWithProfile = {
  id: string
  attendance_record_id: string | null
  user_id: string
  user_name: string
  department: string
  appeal_date: string
  current_status: string
  requested_status: string
  appeal_reason: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

type AppealRow = {
  id: string
  attendance_record_id: string | null
  user_id: string
  appeal_date: string
  current_status: string
  requested_status: string
  appeal_reason: string
  status: string
  reviewed_by: string | null
  reviewed_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

type ProfileRow = {
  id: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  department: string | null
}

export async function GET(request: NextRequest) {
  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const depts = getScopedDepartments(scope)
    const dataClient = getServiceRoleClientOrFallback(supabase)

    const statusParam = request.nextUrl.searchParams.get("status") ?? "all"
    const validStatuses = ["pending", "approved", "rejected", "all"]
    if (!validStatuses.includes(statusParam)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 })
    }

    // Resolve scoped user IDs if dept-filtered
    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ data: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p: { id: string }) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ data: [] })
    }

    // Fetch appeals
    let appealsQuery = dataClient
      .from("attendance_appeals")
      .select(
        "id, attendance_record_id, user_id, appeal_date, current_status, requested_status, appeal_reason, status, reviewed_by, reviewed_at, resolution_note, created_at, updated_at"
      )
      .order("created_at", { ascending: false })

    if (statusParam !== "all") {
      appealsQuery = appealsQuery.eq("status", statusParam)
    }

    if (scopedUserIds !== null) {
      appealsQuery = appealsQuery.in("user_id", scopedUserIds)
    }

    const { data: appeals, error: appealsError } = await appealsQuery.returns<AppealRow[]>()
    if (appealsError) {
      log.error({ err: appealsError }, "Failed to fetch appeals")
      return NextResponse.json({ error: "Failed to fetch appeals" }, { status: 500 })
    }

    const rows = appeals ?? []
    if (rows.length === 0) return NextResponse.json({ data: [] })

    // Fetch profiles for enrichment
    const uniqueUserIds = [...new Set(rows.map((r) => r.user_id))]
    const { data: profiles } = await dataClient
      .from("profiles")
      .select("id, full_name, first_name, last_name, department")
      .in("id", uniqueUserIds)
      .returns<ProfileRow[]>()

    const profileMap = new Map<string, ProfileRow>()
    for (const p of profiles ?? []) profileMap.set(p.id, p)

    const data: AppealWithProfile[] = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const user_name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"
      return {
        ...r,
        user_name,
        department: p?.department ?? "",
      }
    })

    return NextResponse.json({ data })
  } catch (err) {
    log.error({ err: String(err) }, "Error in GET /api/admin/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const body = (await request.json()) as {
      id?: unknown
      action?: unknown
      resolution_note?: unknown
    }

    const appealId = typeof body.id === "string" ? body.id.trim() : ""
    const action = typeof body.action === "string" ? body.action.trim() : ""
    const resolutionNote = typeof body.resolution_note === "string" ? body.resolution_note.trim() : ""

    if (!appealId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }
    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 })
    }
    if (action === "reject" && !resolutionNote) {
      return NextResponse.json({ error: "resolution_note is required when rejecting" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Fetch the appeal
    const { data: appeal, error: fetchError } = await dataClient
      .from("attendance_appeals")
      .select("id, user_id, appeal_date, current_status, requested_status, attendance_record_id, status")
      .eq("id", appealId)
      .maybeSingle<{
        id: string
        user_id: string
        appeal_date: string
        current_status: string
        requested_status: string
        attendance_record_id: string | null
        status: string
      }>()

    if (fetchError || !appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (appeal.status !== "pending") {
      return NextResponse.json(
        { error: `Appeal is already ${appeal.status} and cannot be reviewed again` },
        { status: 409 }
      )
    }

    const now = new Date().toISOString()
    const newStatus = action === "approve" ? "approved" : "rejected"

    // Update the appeal
    const { data: updatedAppeal, error: updateError } = await dataClient
      .from("attendance_appeals")
      .update({
        status: newStatus,
        reviewed_by: scope.userId,
        reviewed_at: now,
        resolution_note: resolutionNote || null,
        updated_at: now,
      })
      .eq("id", appealId)
      .select()
      .single()

    if (updateError || !updatedAppeal) {
      log.error({ err: updateError }, "Failed to update appeal")
      return NextResponse.json({ error: "Failed to update appeal" }, { status: 500 })
    }

    let approvedRecordId: string | null = appeal.attendance_record_id
    if (action === "approve") {
      // Upsert the attendance record to reflect the approved status
      const { data: upserted, error: upsertError } = await dataClient
        .from("attendance_records")
        .upsert(
          {
            user_id: appeal.user_id,
            date: appeal.appeal_date,
            status: appeal.requested_status,
            manual_comment: resolutionNote || `Appeal approved: ${appeal.requested_status}`,
            source: "manual",
          },
          { onConflict: "user_id,date" }
        )
        .select("id")
        .maybeSingle<{ id: string }>()

      if (upsertError) {
        log.error({ err: upsertError }, "Failed to upsert attendance record on approval")
        // Non-fatal — appeal is still approved
      } else if (upserted?.id) {
        approvedRecordId = upserted.id
      }
    }

    // Provenance: record the decision on the day's timeline + org-wide compliance audit.
    await recordAttendanceEvent(dataClient, {
      userId: appeal.user_id,
      eventDate: appeal.appeal_date,
      eventType: action === "approve" ? "appeal_approved" : "appeal_rejected",
      attendanceRecordId: approvedRecordId,
      fromStatus: appeal.current_status,
      toStatus: action === "approve" ? appeal.requested_status : appeal.current_status,
      source: "appeal",
      comment: resolutionNote || null,
      actorId: scope.userId,
      metadata: { appeal_id: appeal.id, requested_status: appeal.requested_status },
    })
    await writeAuditLog(
      supabase,
      {
        action: action === "approve" ? "approve" : "reject",
        entityType: "attendance_appeal",
        entityId: appeal.id,
        newValues: {
          user_id: appeal.user_id,
          status: newStatus,
          appeal_date: appeal.appeal_date,
          requested_status: appeal.requested_status,
          resolution_note: resolutionNote || null,
        },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/appeals" },
      },
      { failOpen: true }
    )

    // Notify the employee
    try {
      await dataClient.rpc("create_notification", {
        p_user_id: appeal.user_id,
        p_type: action === "approve" ? "approval_granted" : "approval_rejected",
        p_category: "approvals",
        p_title: action === "approve" ? "Attendance Appeal Approved" : "Attendance Appeal Rejected",
        p_message:
          action === "approve"
            ? `Your attendance appeal for ${appeal.appeal_date} has been approved. Status updated to ${appeal.requested_status}.`
            : `Your attendance appeal for ${appeal.appeal_date} has been rejected.${resolutionNote ? ` Note: ${resolutionNote}` : ""}`,
        p_priority: "normal",
        p_link_url: "/attendance",
        p_actor_id: scope.userId,
        p_entity_type: "attendance_appeal",
        p_entity_id: appeal.id,
      })
    } catch (notifyErr) {
      log.error({ err: String(notifyErr) }, "Failed to notify employee of appeal decision")
    }

    return NextResponse.json({ data: updatedAppeal })
  } catch (err) {
    log.error({ err: String(err) }, "Error in PATCH /api/admin/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
