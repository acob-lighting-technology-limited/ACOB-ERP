import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { recordAttendanceEvent } from "@/lib/hr/attendance-events"
import { resolvePendingAppealOnManualStatus } from "@/lib/hr/attendance-appeals"
import { notifyAttendanceInApp } from "@/lib/hr/attendance-notify"
import { loadDayContext } from "@/lib/hr/attendance-day-context"
import { toLocalISODate, loadAttendancePolicy } from "@/lib/hr/attendance-utils"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import {
  DB_WRITABLE_STATUSES,
  deriveUnifiedAttendanceStatus,
  isPermissionAttendanceStatus,
} from "@/lib/hr/attendance-status"
import { validateLwpAwpMonthlyQuota } from "@/lib/hr/attendance-quota"

const CreateSchema = z.object({
  user_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clock_in: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
  clock_out: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
  status: z.enum(DB_WRITABLE_STATUSES).optional(),
  waived: z.boolean().optional(),
  manual_comment: z.string().trim().min(3, "Manual attendance changes require a comment").max(500),
})

const log = logger("admin-hr-attendance-records")
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-records:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult
    const policy = await loadAttendancePolicy(supabase)

    const depts = getScopedDepartments(scope)
    const { searchParams } = request.nextUrl
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const userId = searchParams.get("user_id")
    const includeAll = searchParams.get("include_all") === "1" || searchParams.get("include_all") === "true"
    // Department lock from the dept console (/dept/[id]/hr/attendance). Narrows
    // results to a single department even for global roles whose data scope is
    // otherwise "all" — this is what enforces dept guarding on the dept pages.
    const departmentParam = (searchParams.get("department") || "").trim()

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Resolve the set of user IDs visible to this admin/lead
    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ records: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ records: [] })
    }

    // Narrow to the requested department, intersected with the caller's scope.
    if (departmentParam && departmentParam.toLowerCase() !== "all") {
      const deptVariants = expandDepartmentScopeForQuery([departmentParam])
      const { data: deptProfiles } = await dataClient.from("profiles").select("id").in("department", deptVariants)
      const deptUserIds = (deptProfiles ?? []).map((p) => p.id)
      if (deptUserIds.length === 0) return NextResponse.json({ records: [] })
      scopedUserIds = scopedUserIds === null ? deptUserIds : scopedUserIds.filter((id) => deptUserIds.includes(id))
      if (scopedUserIds.length === 0) return NextResponse.json({ records: [] })
    }

    let attendanceQuery = dataClient
      .from("attendance_records")
      .select(
        "id, user_id, date, clock_in, clock_out, total_hours, status, source, clock_in_source, clock_out_source, waived, manual_comment, updated_at, selfie_url, selfie_out_url, face_match_confidence, face_verified, location_verified, latitude, longitude, site_id"
      )
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500)

    if (startDate) attendanceQuery = attendanceQuery.gte("date", startDate)
    if (endDate) attendanceQuery = attendanceQuery.lte("date", endDate)
    // If a specific user_id was requested, honour it only when it falls within scope
    if (userId) {
      if (scopedUserIds !== null && !scopedUserIds.includes(userId)) {
        return NextResponse.json({ records: [] })
      }
      attendanceQuery = attendanceQuery.eq("user_id", userId)
    } else if (scopedUserIds !== null) {
      attendanceQuery = attendanceQuery.in("user_id", scopedUserIds)
    }

    const { data, error } = await attendanceQuery

    if (error) {
      log.error({ err: String(error) }, "Failed to fetch admin attendance records")
      return NextResponse.json({ error: "Failed to fetch records" }, { status: 500 })
    }

    const rows = data ?? []

    // Collect unique user IDs and date bounds for context lookups
    const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
    const allDates = rows.map((r) => r.date).sort()
    const minDate = allDates[0] ?? toLocalISODate()
    const maxDate = allDates[allDates.length - 1] ?? toLocalISODate()

    const recordIds = rows.map((r) => r.id).filter((id) => id && !id.startsWith("missing-"))

    // Fetch profiles + audit logs (editor attribution) in parallel with the shared day context.
    const [profileRows, auditLogRows, ctx] = await Promise.all([
      userIds.length > 0
        ? dataClient
            .from("profiles")
            .select("id, full_name, first_name, last_name, department, attendance_exempt")
            .in("id", userIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),

      recordIds.length > 0
        ? dataClient
            .from("audit_logs")
            .select("entity_id, user_id, created_at")
            .eq("entity_type", "attendance_record")
            .in("entity_id", recordIds)
            .order("created_at", { ascending: false })
            .then((r) => r.data ?? [])
        : Promise.resolve([]),

      loadDayContext(dataClient, { userIds, start: minDate, end: maxDate }),
    ])

    // Build audit log lookups to find the latest editor for each record
    const editorIdByRecordId = new Map<string, string>()
    for (const log of auditLogRows as Array<{ entity_id: string; user_id: string }>) {
      if (!editorIdByRecordId.has(log.entity_id)) {
        editorIdByRecordId.set(log.entity_id, log.user_id)
      }
    }

    const editorUserIds = [...new Set(Array.from(editorIdByRecordId.values()).filter(Boolean))]
    const editorProfileRows =
      editorUserIds.length > 0
        ? await dataClient
            .from("profiles")
            .select("id, first_name, last_name, full_name")
            .in("id", editorUserIds)
            .then((r) => r.data ?? [])
        : []

    const editorProfileMap = new Map<
      string,
      { first_name?: string | null; last_name?: string | null; full_name?: string | null }
    >()
    for (const p of editorProfileRows) {
      editorProfileMap.set(p.id, p)
    }

    // Build lookup structures
    const profileMap = new Map<
      string,
      { full_name?: string; first_name?: string; last_name?: string; department?: string; attendance_exempt?: boolean }
    >()
    for (const p of profileRows) profileMap.set(p.id, p)

    const records = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"

      const closeTime = ctx.earlyCloseTime(r.date)
      const derivedStatus = deriveUnifiedAttendanceStatus(
        {
          record: r,
          isHoliday: ctx.isHoliday(r.date),
          isOnLeave: ctx.isOnLeave(r.user_id, r.date),
          isOnUnpaidLeave: ctx.isOnUnpaidLeave(r.user_id, r.date),
          isExempted: Boolean(p?.attendance_exempt) || ctx.isExempt(r.user_id, r.date),
          recordDate: r.date,
          earlyClosure: closeTime ? { closeTime } : null,
        },
        policy
      )

      const lateRes = ctx.lateResumptionTime(r.date)
      const editorUserId = editorIdByRecordId.get(r.id)
      const editorProfile = editorUserId ? editorProfileMap.get(editorUserId) : null
      const editorFirstName = editorProfile?.first_name || editorProfile?.full_name?.split(" ")[0] || null

      return {
        id: r.id,
        user_id: r.user_id,
        user_name: name,
        department: p?.department ?? "",
        date: r.date,
        clock_in: r.clock_in,
        clock_out: r.clock_out,
        total_hours: r.total_hours,
        status: derivedStatus,
        source: r.source,
        clock_in_source: r.clock_in_source ?? null,
        clock_out_source: r.clock_out_source ?? null,
        waived: r.waived,
        manual_comment: r.manual_comment ?? null,
        updated_at: r.updated_at,
        selfie_url: r.selfie_url ?? null,
        selfie_out_url: r.selfie_out_url ?? null,
        face_match_confidence: r.face_match_confidence ?? null,
        face_verified: r.face_verified ?? null,
        location_verified: r.location_verified ?? null,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        site_id: r.site_id ?? null,
        editor_first_name: editorFirstName,
        early_closure_time: closeTime,
        late_resumption_time: lateRes,
      }
    })

    // ── include_all: append every active in-scope employee with no record for the day ──
    const singleDay = Boolean(startDate && endDate && startDate === endDate)
    if (includeAll && singleDay && !userId) {
      const day = startDate as string

      let profileUniverseQuery = dataClient
        .from("profiles")
        .select("id, full_name, first_name, last_name, department, attendance_exempt")
        .eq("employment_status", "active")
      if (scopedUserIds !== null) profileUniverseQuery = profileUniverseQuery.in("id", scopedUserIds)
      const { data: universeProfiles } = await profileUniverseQuery
      const universe = universeProfiles ?? []

      const haveRecord = new Set(records.map((r) => r.user_id))
      const missing = universe.filter((p) => !haveRecord.has(p.id))

      if (missing.length > 0) {
        const missingIds = missing.map((p) => p.id)
        const [dayHolidayRows, dayLeaveRows, dayExemptRows] = await Promise.all([
          dataClient
            .from("holiday_calendar")
            .select("holiday_date")
            .eq("holiday_date", day)
            .then((r) => r.data ?? []),
          dataClient
            .from("leave_requests")
            .select("user_id, leave_type:leave_types!leave_requests_leave_type_id_fkey(is_paid)")
            .in("user_id", missingIds)
            .eq("status", "approved")
            .lte("start_date", day)
            .gte("end_date", day)
            .then((r) => r.data ?? []),
          dataClient
            .from("attendance_exempt_periods")
            .select("user_id")
            .in("user_id", missingIds)
            .lte("start_date", day)
            .gte("end_date", day)
            .then((r) => r.data ?? []),
        ])
        const isHoliday = dayHolidayRows.length > 0
        type DayLeaveRow = { user_id: string; leave_type?: { is_paid?: boolean | null } | null }
        const dayLeaves = dayLeaveRows as unknown as DayLeaveRow[]
        const onLeaveSet = new Set(dayLeaves.map((r) => r.user_id))
        const onUnpaidLeaveSet = new Set(dayLeaves.filter((r) => r.leave_type?.is_paid === false).map((r) => r.user_id))
        const exemptPeriodSet = new Set((dayExemptRows as { user_id: string }[]).map((r) => r.user_id))

        const closeTime = ctx.earlyCloseTime(day)
        const lateRes = ctx.lateResumptionTime(day)

        for (const p of missing) {
          const name = p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown"
          const derivedStatus = deriveUnifiedAttendanceStatus(
            {
              record: null,
              isHoliday,
              isOnLeave: onLeaveSet.has(p.id),
              isOnUnpaidLeave: onUnpaidLeaveSet.has(p.id),
              isExempted: Boolean(p.attendance_exempt) || exemptPeriodSet.has(p.id),
              recordDate: day,
              earlyClosure: closeTime ? { closeTime } : null,
              lateResumption: lateRes ? { resumptionTime: lateRes } : null,
            },
            policy
          )
          records.push({
            id: `missing-${p.id}-${day}`,
            user_id: p.id,
            user_name: name,
            department: p.department ?? "",
            date: day,
            clock_in: null,
            clock_out: null,
            total_hours: null,
            status: derivedStatus,
            source: null,
            clock_in_source: null,
            clock_out_source: null,
            waived: false,
            manual_comment: null,
            updated_at: null,
            selfie_url: null,
            selfie_out_url: null,
            face_match_confidence: null,
            face_verified: null,
            location_verified: null,
            latitude: null,
            longitude: null,
            site_id: null,
            editor_first_name: null,
            early_closure_time: closeTime,
            late_resumption_time: lateRes,
          })
        }
      }
    }

    return NextResponse.json({ records })
  } catch (error) {
    log.error({ err: String(error) }, "Error in GET /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-create:${getClientId(request)}`, { limit: 20, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  try {
    const scopeResult = await requireApiAdminScope()
    if (!scopeResult.ok) return scopeResult.response
    const { scope, supabase } = scopeResult
    const policy = await loadAttendancePolicy(supabase)

    const parsed = CreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_id, date, clock_in, clock_out, waived, manual_comment } = parsed.data
    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Validate the target employee is in this admin/lead's scope
    const depts = getScopedDepartments(scope)
    if (depts !== null) {
      const { data: targetProfile } = await dataClient
        .from("profiles")
        .select("department")
        .eq("id", user_id)
        .maybeSingle()
      if (!targetProfile || !depts.includes(targetProfile.department || "")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Check for existing record on this date
    const { data: existing } = await dataClient
      .from("attendance_records")
      .select("id")
      .eq("user_id", user_id)
      .eq("date", date)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ error: "A record already exists for this date" }, { status: 409 })
    }

    // Auto-determine status via the single shared deriver (unless an explicit status was provided)
    const explicitStatus = parsed.data.status
    const status =
      explicitStatus ??
      (waived
        ? "waiver"
        : deriveUnifiedAttendanceStatus(
            {
              record: { clock_in, clock_out, waived: false, status: explicitStatus },
              recordDate: date,
            },
            policy
          ))
    const isCoveredWithoutTimes =
      status === "waiver" || status === "absent_with_permission" || status === "out_of_station"
    const isLWP = status === "lateness_with_permission"

    const quotaCheck = await validateLwpAwpMonthlyQuota({
      dataClient,
      userId: user_id,
      targetStatus: status,
      date,
      isAdminLike: scope.isAdminLike,
    })
    if (!quotaCheck.allowed) {
      return NextResponse.json({ error: quotaCheck.error }, { status: 403 })
    }

    if (clock_in && clock_out && clock_out <= clock_in) {
      return NextResponse.json({ error: "Clock out must be after clock in" }, { status: 400 })
    }
    if (!isCoveredWithoutTimes && !isLWP && !clock_in && !clock_out) {
      return NextResponse.json({ error: "Provide both clock in and clock out before saving" }, { status: 400 })
    }
    if (!isCoveredWithoutTimes && !isLWP && ((clock_in && !clock_out) || (!clock_in && clock_out))) {
      return NextResponse.json({ error: "Clock in and clock out must be provided together" }, { status: 400 })
    }
    if (isLWP && !clock_in && !clock_out) {
      return NextResponse.json(
        { error: "LWP requires at least one clock punch (clock in or clock out)" },
        { status: 400 }
      )
    }
    if (status === "waiver" && !manual_comment.trim()) {
      return NextResponse.json({ error: "Waiver requires a reason or comment" }, { status: 400 })
    }

    const insert: Record<string, unknown> = {
      user_id,
      date,
      status,
      source: "manual",
      manual_comment,
      waived: status === "waiver" ? true : Boolean(waived),
    }
    if (clock_in) {
      insert.clock_in = clock_in
      insert.clock_in_source = "manual"
    }
    if (clock_out) {
      insert.clock_out = clock_out
      insert.clock_out_source = "manual"
    }
    if (clock_in && clock_out) {
      const inMs = new Date(`${date}T${clock_in}Z`).getTime()
      const outMs = new Date(`${date}T${clock_out}Z`).getTime()
      const rawHours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
      const breakDuration = rawHours >= 5 ? 60 : 0
      insert.total_hours = rawHours - breakDuration / 60
      insert.break_duration = breakDuration
    }

    const { data: created, error } = await dataClient.from("attendance_records").insert(insert).select().single()

    if (error) {
      log.error({ err: JSON.stringify(error) }, "Failed to create attendance record")
      return NextResponse.json({ error: "Failed to create record" }, { status: 500 })
    }

    await writeAuditLog(
      supabase,
      {
        action: "create",
        entityType: "attendance_record",
        entityId: created.id,
        newValues: insert,
        context: { actorId: scope.userId, source: "api", route: "/api/admin/hr/attendance/records" },
      },
      { failOpen: true }
    )

    // Provenance + appeal auto-resolution (replaces the old DB trigger).
    await recordAttendanceEvent(dataClient, {
      userId: user_id,
      eventDate: date,
      eventType: "manual_create",
      attendanceRecordId: created.id,
      toStatus: status,
      source: "manual",
      comment: manual_comment,
      actorId: scope.userId,
      metadata: { clock_in: clock_in ?? null, clock_out: clock_out ?? null },
    })
    await resolvePendingAppealOnManualStatus(dataClient, {
      userId: user_id,
      date,
      status,
      attendanceRecordId: created.id,
      comment: manual_comment,
      actorId: scope.userId,
    })
    await notifyAttendanceInApp(dataClient, {
      affectedUserId: user_id,
      actorId: scope.userId,
      date,
      toStatus: status,
      action: "created",
      entityId: created.id,
    })

    return NextResponse.json({ data: created, message: "Record created" }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
