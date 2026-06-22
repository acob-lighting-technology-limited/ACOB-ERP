import { NextRequest, NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { parseISODate, addDays, toISODate } from "@/lib/hr/leave-workflow"

const log = logger("admin-hr-attendance-leave-manual")
export const dynamic = "force-dynamic"

const ManualLeaveSchema = z.object({
  user_id: z.string().uuid(),
  leave_type_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3, "A reason of at least 3 characters is required").max(500),
})

/** Inclusive calendar-day span — mirrors the leave request route's days_count fallback. */
function calendarDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${start}T00:00:00.000Z`).getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1
}

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

/** Consume leave balance for the year (used_days += days). Mirrors restoreBalance in reverse. */
async function consumeBalance(dataClient: SupabaseClient, userId: string, leaveTypeId: string, days: number) {
  if (days <= 0) return
  const year = new Date().getUTCFullYear()
  const { data: bal } = await dataClient
    .from("leave_balances")
    .select("id, used_days")
    .eq("user_id", userId)
    .eq("leave_type_id", leaveTypeId)
    .eq("year", year)
    .maybeSingle<{ id: string; used_days: number | null }>()
  if (!bal) return
  await dataClient
    .from("leave_balances")
    .update({ used_days: Number(bal.used_days || 0) + days })
    .eq("id", bal.id)
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

    const days_count = calendarDays(start_date, end_date)
    const resume_date = toISODate(addDays(parseISODate(end_date), 1))
    const now = new Date().toISOString()

    const { data: created, error } = await dataClient
      .from("leave_requests")
      .insert({
        user_id,
        leave_type_id,
        start_date,
        end_date,
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

    // Consume balance (used_days += days) for the type's current-year balance row, if any.
    await consumeBalance(dataClient, user_id, leave_type_id, days_count)

    // NOTE: we intentionally do NOT write on_leave rows into attendance_records. Status
    // derivation already returns "on_leave" from the approved leave_requests row, so the
    // roster reflects the leave without us overwriting (and destroying) any real punch
    // records on those days. Removing the leave reverts the day to its real status.

    await recordAttendanceEvent(dataClient, {
      userId: user_id,
      eventDate: start_date,
      eventType: "leave_granted",
      toStatus: "on_leave",
      source: "manual",
      comment: reason,
      actorId: scope.userId,
      metadata: { leave_request_id: created.id, leave_type_id, start_date, end_date, days_count },
    })

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "leave_request",
        entityId: created.id,
        newValues: { user_id, leave_type_id, start_date, end_date, days_count, status: "approved", admin_manual: true },
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/leave/manual" },
      },
      { failOpen: true }
    )

    try {
      await dataClient.rpc("create_notification", {
        p_user_id: user_id,
        p_type: "approval_granted",
        p_category: "approvals",
        p_title: "Leave Recorded",
        p_message: `Approved leave was recorded on your behalf for ${start_date} to ${end_date} (${days_count} day(s)).`,
        p_priority: "normal",
        p_link_url: "/leave",
        p_actor_id: scope.userId,
        p_entity_type: "leave_request",
        p_entity_id: created.id,
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

    // Restore the consumed balance (mirrors restoreBalance in the leave lifecycle).
    if (days > 0) {
      const year = new Date().getUTCFullYear()
      const { data: bal } = await dataClient
        .from("leave_balances")
        .select("id, used_days")
        .eq("user_id", leave.user_id)
        .eq("leave_type_id", leave.leave_type_id)
        .eq("year", year)
        .maybeSingle<{ id: string; used_days: number | null }>()
      if (bal) {
        await dataClient
          .from("leave_balances")
          .update({ used_days: Math.max(0, Number(bal.used_days || 0) - days) })
          .eq("id", bal.id)
      }
    }

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
