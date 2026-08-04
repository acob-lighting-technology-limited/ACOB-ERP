import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { toLocalYearMonth, monthBounds, loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"

const log = logger("hr-attendance-appeals")
export const dynamic = "force-dynamic"

const APPEALABLE_STATUSES = ["absent", "late", "incomplete"] as const
type AppealableStatus = (typeof APPEALABLE_STATUSES)[number]

const ALLOWED_REQUESTED_STATUSES = ["absent_with_permission", "lateness_with_permission"] as const
type AllowedRequestedStatus = (typeof ALLOWED_REQUESTED_STATUSES)[number]

function isAppealableStatus(s: string): s is AppealableStatus {
  return (APPEALABLE_STATUSES as readonly string[]).includes(s)
}

function isAllowedRequestedStatus(s: string): s is AllowedRequestedStatus {
  return (ALLOWED_REQUESTED_STATUSES as readonly string[]).includes(s)
}

/** Returns the two allowed year-months: current and previous. */
function getAllowedMonths(): [string, string] {
  const now = new Date()
  const current = toLocalYearMonth(now)
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const previous = toLocalYearMonth(prev)
  return [current, previous]
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const yearMonth = request.nextUrl.searchParams.get("year_month")

    let query = dataClient
      .from("attendance_appeals")
      .select(
        "id, attendance_record_id, user_id, appeal_date, current_status, requested_status, appeal_reason, status, reviewed_by, reviewed_at, resolution_note, created_at, updated_at"
      )
      .eq("user_id", user.id)
      .order("appeal_date", { ascending: false })

    if (yearMonth) {
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        return NextResponse.json({ error: "year_month is invalid" }, { status: 400 })
      }
      const { start, end } = monthBounds(yearMonth)
      query = query.gte("appeal_date", start).lte("appeal_date", end)
    }

    const { data, error } = await query
    if (error) {
      log.error({ err: error }, "Failed to fetch appeals")
      return NextResponse.json({ error: "Failed to fetch appeals" }, { status: 500 })
    }

    return NextResponse.json({ data: data ?? [] })
  } catch (err) {
    log.error({ err: String(err) }, "Error in GET /api/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const policy = await loadAttendancePolicy(supabase)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json()) as {
      appeal_date?: unknown
      requested_status?: unknown
      appeal_reason?: unknown
    }

    const appealDate = typeof body.appeal_date === "string" ? body.appeal_date.trim() : ""
    const requestedStatus = typeof body.requested_status === "string" ? body.requested_status.trim() : ""
    const appealReason = typeof body.appeal_reason === "string" ? body.appeal_reason.trim() : ""

    // Validate presence
    if (!appealDate || !requestedStatus || !appealReason) {
      return NextResponse.json(
        { error: "appeal_date, requested_status, and appeal_reason are required" },
        { status: 400 }
      )
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appealDate)) {
      return NextResponse.json({ error: "appeal_date must be in YYYY-MM-DD format" }, { status: 400 })
    }

    // Validate appeal_date is within current or previous month
    const [currentMonth, previousMonth] = getAllowedMonths()
    const appealYearMonth = appealDate.slice(0, 7)
    if (appealYearMonth !== currentMonth && appealYearMonth !== previousMonth) {
      return NextResponse.json({ error: "Appeals are only allowed for the current or previous month" }, { status: 400 })
    }

    // Validate requested_status
    if (!isAllowedRequestedStatus(requestedStatus)) {
      return NextResponse.json(
        { error: "requested_status must be absent_with_permission or lateness_with_permission" },
        { status: 400 }
      )
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Check for existing pending/approved appeal for the same day
    const { data: existingAppeal } = await dataClient
      .from("attendance_appeals")
      .select("id, status")
      .eq("user_id", user.id)
      .eq("appeal_date", appealDate)
      .in("status", ["pending", "approved"])
      .maybeSingle()

    if (existingAppeal) {
      return NextResponse.json({ error: `An active appeal already exists for ${appealDate}` }, { status: 409 })
    }

    // Find attendance record for that date (nullable — absent days may have no record)
    const { data: attendanceRecord } = await dataClient
      .from("attendance_records")
      .select("id, clock_in, clock_out, status, waived")
      .eq("user_id", user.id)
      .eq("date", appealDate)
      .maybeSingle()

    // Derive the current unified status
    const currentStatus = deriveUnifiedAttendanceStatus({
      record: attendanceRecord ?? null,
      recordDate: appealDate,
    }, policy)

    // Validate it's an appealable status
    if (!isAppealableStatus(currentStatus)) {
      return NextResponse.json(
        {
          error: `Cannot appeal a day with status '${currentStatus}'. Only absent, late, or incomplete days are eligible.`,
        },
        { status: 422 }
      )
    }

    // Validate requested_status matches the rule
    // absent → AWP only; late/incomplete → LWP only
    if (currentStatus === "absent" && requestedStatus !== "absent_with_permission") {
      return NextResponse.json(
        { error: "Absent days can only be appealed as absent_with_permission (AWP)" },
        { status: 422 }
      )
    }
    if (
      (currentStatus === "late" || currentStatus === "incomplete") &&
      requestedStatus !== "lateness_with_permission"
    ) {
      return NextResponse.json(
        { error: "Late or incomplete days can only be appealed as lateness_with_permission (LWP)" },
        { status: 422 }
      )
    }

    // Insert the appeal
    const { data: appeal, error: insertError } = await dataClient
      .from("attendance_appeals")
      .insert({
        attendance_record_id: attendanceRecord?.id ?? null,
        user_id: user.id,
        appeal_date: appealDate,
        current_status: currentStatus,
        requested_status: requestedStatus,
        appeal_reason: appealReason,
        status: "pending",
      })
      .select()
      .single()

    if (insertError || !appeal) {
      log.error({ err: insertError }, "Failed to insert appeal")
      return NextResponse.json({ error: "Failed to submit appeal" }, { status: 500 })
    }

    // Provenance: the employee's appeal request joins the day's timeline.
    await recordAttendanceEvent(dataClient, {
      userId: user.id,
      eventDate: appealDate,
      eventType: "appeal_requested",
      attendanceRecordId: attendanceRecord?.id ?? null,
      fromStatus: currentStatus,
      toStatus: requestedStatus,
      source: "appeal",
      comment: appealReason,
      actorId: user.id,
      metadata: { appeal_id: appeal.id },
    })

    // Notify the employee's department lead (or super admins if none)
    try {
      const { data: employeeProfile } = await dataClient
        .from("profiles")
        .select("department, full_name, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle<{
          department: string | null
          full_name: string | null
          first_name: string | null
          last_name: string | null
        }>()

      const employeeDept = employeeProfile?.department ?? null
      const employeeName =
        employeeProfile?.full_name?.trim() ||
        [employeeProfile?.first_name, employeeProfile?.last_name].filter(Boolean).join(" ") ||
        "An employee"

      type ProfileRow = { id: string }
      let recipientIds: string[] = []

      if (employeeDept) {
        const { data: leads } = await dataClient
          .from("profiles")
          .select("id")
          .eq("department", employeeDept)
          .eq("is_department_lead", true)
          .returns<ProfileRow[]>()
        recipientIds = (leads ?? []).map((l) => l.id)
      }

      if (recipientIds.length === 0) {
        // Fall back to super admins
        const { data: superAdmins } = await dataClient
          .from("profiles")
          .select("id")
          .eq("is_super_admin", true)
          .returns<ProfileRow[]>()
        recipientIds = (superAdmins ?? []).map((a) => a.id)
      }

      for (const recipientId of recipientIds) {
        try {
          await dataClient.rpc("create_notification", {
            p_user_id: recipientId,
            p_type: "approval_request",
            p_category: "approvals",
            p_title: "Attendance Appeal Submitted",
            p_message: `${employeeName} has submitted an attendance appeal for ${appealDate} (${currentStatus} → ${requestedStatus}).`,
            p_priority: "normal",
            p_link_url: "/admin/hr/attendance/appeals",
            p_actor_id: user.id,
            p_entity_type: "attendance_appeal",
            p_entity_id: appeal.id,
          })
        } catch (notifyErr) {
          log.error({ err: String(notifyErr), recipientId }, "Failed to notify recipient")
        }
      }
    } catch (notifyErr) {
      log.error({ err: String(notifyErr) }, "Failed to send appeal notifications")
    }

    return NextResponse.json({ data: appeal }, { status: 201 })
  } catch (err) {
    log.error({ err: String(err) }, "Error in POST /api/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = (await request.json()) as {
      id?: unknown
      appeal_reason?: unknown
    }

    const id = typeof body.id === "string" ? body.id.trim() : ""
    const appealReason = typeof body.appeal_reason === "string" ? body.appeal_reason.trim() : ""

    if (!id || !appealReason) {
      return NextResponse.json({ error: "id and appeal_reason are required" }, { status: 400 })
    }

    if (appealReason.length < 10) {
      return NextResponse.json({ error: "appeal_reason must be at least 10 characters" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Fetch the appeal to verify ownership and pending status
    const { data: appeal, error: fetchError } = await dataClient
      .from("attendance_appeals")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle()

    if (fetchError || !appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (appeal.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized to edit this appeal" }, { status: 403 })
    }

    if (appeal.status !== "pending") {
      return NextResponse.json({ error: `Cannot edit an appeal that is already ${appeal.status}` }, { status: 400 })
    }

    const { data: updatedAppeal, error: updateError } = await dataClient
      .from("attendance_appeals")
      .update({
        appeal_reason: appealReason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single()

    if (updateError || !updatedAppeal) {
      log.error({ err: updateError }, "Failed to update appeal reason")
      return NextResponse.json({ error: "Failed to update appeal" }, { status: 500 })
    }

    return NextResponse.json({ data: updatedAppeal })
  } catch (err) {
    log.error({ err: String(err) }, "Error in PATCH /api/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const id = request.nextUrl.searchParams.get("id") ?? ""
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Fetch the appeal to verify ownership and pending status
    const { data: appeal, error: fetchError } = await dataClient
      .from("attendance_appeals")
      .select("id, user_id, status")
      .eq("id", id)
      .maybeSingle()

    if (fetchError || !appeal) {
      return NextResponse.json({ error: "Appeal not found" }, { status: 404 })
    }

    if (appeal.user_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized to cancel this appeal" }, { status: 403 })
    }

    if (appeal.status !== "pending") {
      return NextResponse.json({ error: `Cannot cancel an appeal that is already ${appeal.status}` }, { status: 400 })
    }

    const { error: deleteError } = await dataClient.from("attendance_appeals").delete().eq("id", id)

    if (deleteError) {
      log.error({ err: deleteError }, "Failed to delete appeal")
      return NextResponse.json({ error: "Failed to cancel appeal" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    log.error({ err: String(err) }, "Error in DELETE /api/hr/attendance/appeals")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
