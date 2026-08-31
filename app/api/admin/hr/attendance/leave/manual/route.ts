import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { formatLeaveReference, getHolidaySet, notifyUsers } from "@/lib/hr/leave-workflow"
import { addIsoDays, countLeaveDays, nextWorkingDayAfter, trimRangeToWorkingDays } from "@/lib/hr/leave-days"

const log = logger("admin-hr-attendance-leave-manual")
export const dynamic = "force-dynamic"

const ManualLeaveSchema = z.object({
  user_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3, "A reason of at least 3 characters is required").max(500),
})

async function assertInScope(
  dataClient: SupabaseClient,
  scope: Parameters<typeof getScopedDepartments>[0],
  userId: string
): Promise<boolean> {
  const depts = getScopedDepartments(scope)
  if (depts === null) return true
  const { data } = await dataClient
    .from("profiles")
    .select("department")
    .eq("id", userId)
    .maybeSingle<{ department: string | null }>()
  return Boolean(data && depts.includes(data.department || ""))
}

// ── Create an approved leave grant (bypasses the request workflow) ──────────────────────
export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-manual:${getClientId(request)}`, { limit: 15, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const parsed = ManualLeaveSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }
    const { user_id, leave_type_id, start_date, end_date, reason } = parsed.data
    if (end_date < start_date) {
      return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 })
    }

    const dataClient = getServiceRoleClientOrFallback(supabase)
    if (!(await assertInScope(dataClient, scope, user_id))) {
      return NextResponse.json({ error: "Employee is not within your scope" }, { status: 403 })
    }

    // Same working-day rules as an employee-submitted request: weekends and
    // public holidays are neither charged nor allowed to be the end date, and
    // the resumption date is the next real working day.
    const holidays = await getHolidaySet(dataClient, null, start_date, addIsoDays(end_date, 30))
    const workingRange = trimRangeToWorkingDays(start_date, end_date, holidays)
    if (!workingRange) {
      return NextResponse.json(
        { error: "That range contains no working days — weekends and public holidays are not leave days" },
        { status: 400 }
      )
    }

    const effectiveStartDate = workingRange.start_date
    const effectiveEndDate = workingRange.end_date
    const days_count = countLeaveDays(effectiveStartDate, effectiveEndDate, holidays)
    const resume_date = nextWorkingDayAfter(effectiveEndDate, holidays)
    const now = new Date().toISOString()

    const { data: created, error } = await dataClient
      .from("leave_requests")
      .insert({
        user_id,
        leave_type_id,
        start_date: effectiveStartDate,
        end_date: effectiveEndDate,
        resume_date,
        days_count,
        reason,
        status: "approved",
        approval_stage: "completed",
        current_stage_code: "completed",
        approved_by: scope.userId,
        approved_at: now,
        hr_decision_at: now,
        admin_manual: true,
      })
      .select("id")
      .single()

    if (error || !created) {
      log.error({ err: JSON.stringify(error) }, "Manual leave insert failed")
      return NextResponse.json({ error: "Failed to add leave" }, { status: 500 })
    }

    // No balance to draw down: the approved leave_requests row inserted above is itself what
    // the remaining-days figure is derived from.

    // NOTE: we intentionally do NOT write on_leave rows into attendance_records. Status
    // derivation already returns "on_leave" from the approved leave_requests row, so the
    // roster reflects the leave without us overwriting (and destroying) any real punch
    // records on those days. Removing the leave reverts the day to its real status.

    await recordAttendanceEvent(dataClient, {
      userId: user_id,
      eventDate: effectiveStartDate,
      eventType: "leave_granted",
      toStatus: "on_leave",
      source: "manual",
      comment: reason,
      actorId: scope.userId,
      metadata: {
        leave_request_id: created.id,
        leave_type_id,
        start_date: effectiveStartDate,
        end_date: effectiveEndDate,
        days_count,
      },
    })

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "leave_request",
        entityId: created.id,
        newValues: {
          user_id,
          leave_type_id,
          start_date: effectiveStartDate,
          end_date: effectiveEndDate,
          days_count,
          status: "approved",
          admin_manual: true,
        },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/leave/manual" },
      },
      { failOpen: true }
    )

    try {
      const [{ data: ltRow }, { data: adminProfile }] = await Promise.all([
        dataClient.from("leave_types").select("name").eq("id", leave_type_id).maybeSingle(),
        dataClient.from("profiles").select("full_name, first_name, last_name").eq("id", scope.userId).maybeSingle(),
      ])
      const leaveTypeName = ltRow?.name || "Leave"
      const adminName =
        adminProfile?.full_name ||
        `${adminProfile?.first_name || ""} ${adminProfile?.last_name || ""}`.trim() ||
        "HR Administrator"
      const ref = formatLeaveReference(created.id)
      const refSuffix = ref ? ` — ${ref}` : ""

      await notifyUsers(dataClient, {
        userIds: [user_id],
        title: "Leave recorded on your behalf",
        message: `Approved leave for ${leaveTypeName} was recorded on your behalf by ${adminName} for ${effectiveStartDate} to ${effectiveEndDate} (${days_count} day(s)).`,
        actorId: scope.userId,
        linkUrl: "/leave",
        entityId: created.id,
        emailEvent: "approved",
        emailSubject: `Leave Recorded on Your Behalf — ${leaveTypeName}${refSuffix}`,
        emailTitle: "Leave Recorded by Management",
        badgeText: "Leave Recorded",
        badgeVariant: "success",
        detailsTitle: "Approved Leave Schedule",
        details: [
          { label: "Leave Type", value: leaveTypeName },
          { label: "Duration", value: `${days_count} day(s)` },
          { label: "Start Date", value: effectiveStartDate },
          { label: "End Date", value: effectiveEndDate },
          { label: "Resumption Date", value: resume_date },
          { label: "Recorded By", value: adminName },
          { label: "Reason / Notes", value: reason },
        ],
        ctaLabel: "View Leave Details",
      })
    } catch (notifyErr) {
      log.error({ err: String(notifyErr) }, "Failed to notify employee of manual leave")
    }

    return NextResponse.json({ message: "Leave recorded", id: created.id, days_count })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/leave/manual")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// ── List manager-created leave grants ───────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-manual-list:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult
    const dataClient = getServiceRoleClientOrFallback(supabase)

    let scopedUserIds: string[] | null = null
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ data: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ data: [] })
    }

    let query = dataClient
      .from("leave_requests")
      .select("id, user_id, start_date, end_date, days_count, reason, status, leave_type_id")
      .eq("admin_manual", true)
      .eq("status", "approved")
      .order("start_date", { ascending: false })
      .limit(1000)
    if (scopedUserIds !== null) query = query.in("user_id", scopedUserIds)

    const { data, error } = await query
    if (error) {
      log.error({ err: String(error) }, "Failed to fetch manual leave")
      return NextResponse.json({ error: "Failed to fetch leave records" }, { status: 500 })
    }

    const rows = (data ?? []) as Array<{
      id: string
      user_id: string
      start_date: string
      end_date: string
      days_count: number | null
      reason: string | null
      leave_type_id: string | null
    }>

    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const typeIds = [...new Set(rows.map((r) => r.leave_type_id).filter(Boolean))] as string[]
    const [profiles, types] = await Promise.all([
      userIds.length > 0
        ? dataClient
            .from("profiles")
            .select("id, full_name, first_name, last_name")
            .in("id", userIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      typeIds.length > 0
        ? dataClient
            .from("leave_types")
            .select("id, name")
            .in("id", typeIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
    ])
    const nameMap = new Map<string, string>()
    for (const p of profiles)
      nameMap.set(p.id, p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown")
    const typeMap = new Map<string, string>()
    for (const t of types) typeMap.set(t.id, t.name)

    const result = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      user_name: nameMap.get(r.user_id) ?? "Unknown",
      leave_type: r.leave_type_id ? (typeMap.get(r.leave_type_id) ?? "Leave") : "Leave",
      start_date: r.start_date,
      end_date: r.end_date,
      days_count: r.days_count,
      notes: r.reason ?? null,
    }))

    return NextResponse.json({ data: result })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/leave/manual")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

// ── Revoke a manager-created leave grant (restore balance + clear roster) ────────────────
export async function DELETE(request: NextRequest) {
  const rl = await rateLimit(`admin-hr-leave-manual-delete:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult

    const id = String(request.nextUrl.searchParams.get("id") || "")
    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

    const dataClient = getServiceRoleClientOrFallback(supabase)
    const { data: leave } = await dataClient
      .from("leave_requests")
      .select("id, user_id, leave_type_id, days_count, start_date, end_date, admin_manual")
      .eq("id", id)
      .maybeSingle<{
        id: string
        user_id: string
        leave_type_id: string
        days_count: number | null
        start_date: string
        end_date: string
        admin_manual: boolean
      }>()

    if (!leave) return NextResponse.json({ error: "Leave record not found" }, { status: 404 })
    if (!leave.admin_manual) {
      return NextResponse.json({ error: "Only manager-created leave can be removed here" }, { status: 400 })
    }
    if (!(await assertInScope(dataClient, scope, leave.user_id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const days = Number(leave.days_count || 0)

    const { error } = await dataClient.from("leave_requests").delete().eq("id", id)
    if (error) {
      log.error({ err: JSON.stringify(error) }, "Failed to delete manual leave")
      return NextResponse.json({ error: "Failed to delete leave record" }, { status: 500 })
    }

    // No balance to restore: entitlement is derived from the employee's leave requests, so
    // deleting the request above already frees the days.

    // No attendance_records to clean up — we never wrote on_leave rows (see POST note).
    // Removing the leave_requests row reverts derivation to the day's real status.

    await recordAttendanceEvent(dataClient, {
      userId: leave.user_id,
      eventDate: leave.start_date,
      eventType: "leave_revoked",
      source: "manual",
      actorId: scope.userId,
      metadata: { leave_request_id: id, start_date: leave.start_date, end_date: leave.end_date },
    })

    await writeAuditLog(
      supabase,
      {
        action: "delete",
        entityType: "leave_request",
        entityId: id,
        oldValues: { user_id: leave.user_id, start_date: leave.start_date, end_date: leave.end_date },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/leave/manual" },
      },
      { failOpen: true }
    )

    return NextResponse.json({ message: "Leave removed" })
  } catch (error) {
    log.error({ err: String(error) }, "Error in DELETE /api/admin/hr/attendance/leave/manual")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
