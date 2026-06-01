import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { logger } from "@/lib/logger"
import { rateLimit, getClientId } from "@/lib/rate-limit"
import { writeAuditLog } from "@/lib/audit/write-audit"
import { toLocalISODate } from "@/lib/hr/attendance-utils"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { DB_WRITABLE_STATUSES, deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"

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
  waiver_reason: z.string().max(200).optional().nullable(),
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

    const depts = getScopedDepartments(scope)
    const { searchParams } = request.nextUrl
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")
    const userId = searchParams.get("user_id")
    const includeAll = searchParams.get("include_all") === "1" || searchParams.get("include_all") === "true"

    const dataClient = getServiceRoleClientOrFallback(supabase)

    // Resolve the set of user IDs visible to this admin/lead
    let scopedUserIds: string[] | null = null
    if (depts !== null) {
      if (depts.length === 0) return NextResponse.json({ records: [] })
      const { data: scopedProfiles } = await dataClient.from("profiles").select("id").in("department", depts)
      scopedUserIds = (scopedProfiles ?? []).map((p) => p.id)
      if (scopedUserIds.length === 0) return NextResponse.json({ records: [] })
    }

    let attendanceQuery = dataClient
      .from("attendance_records")
      .select(
        "id, user_id, date, clock_in, clock_out, total_hours, status, source, clock_in_source, clock_out_source, waived, waiver_reason, updated_at, selfie_url, selfie_out_url, face_match_confidence, face_verified, location_verified, latitude, longitude, site_id"
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

    // Fetch profiles, holidays, leaves, and exemptions in parallel
    const [profileRows, holidayRows, leaveRows, exemptPeriodRows] = await Promise.all([
      userIds.length > 0
        ? dataClient
            .from("profiles")
            .select("id, full_name, first_name, last_name, department, attendance_exempt")
            .in("id", userIds)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),

      dataClient
        .from("holiday_calendar")
        .select("holiday_date")
        .gte("holiday_date", minDate)
        .lte("holiday_date", maxDate)
        .then((r) => r.data ?? []),

      userIds.length > 0
        ? dataClient
            .from("leave_requests")
            .select("user_id, start_date, end_date")
            .in("user_id", userIds)
            .eq("status", "approved")
            .lte("start_date", maxDate)
            .gte("end_date", minDate)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),

      userIds.length > 0
        ? dataClient
            .from("attendance_exempt_periods")
            .select("user_id, start_date, end_date")
            .in("user_id", userIds)
            .lte("start_date", maxDate)
            .gte("end_date", minDate)
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
    ])

    // Build lookup structures
    const profileMap = new Map<
      string,
      { full_name?: string; first_name?: string; last_name?: string; department?: string; attendance_exempt?: boolean }
    >()
    for (const p of profileRows) profileMap.set(p.id, p)

    const holidaySet = new Set<string>(holidayRows.map((h: { holiday_date: string }) => h.holiday_date))

    // Per-user leave date sets
    const leaveDatesByUser = new Map<string, Set<string>>()
    for (const lr of leaveRows as { user_id: string; start_date: string; end_date: string }[]) {
      if (!leaveDatesByUser.has(lr.user_id)) leaveDatesByUser.set(lr.user_id, new Set())
      const s = new Date(lr.start_date)
      const e = new Date(lr.end_date)
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        leaveDatesByUser.get(lr.user_id)!.add(toLocalISODate(d))
      }
    }

    // Per-user exemption date sets
    const exemptDatesByUser = new Map<string, Set<string>>()
    for (const ep of exemptPeriodRows as { user_id: string; start_date: string; end_date: string }[]) {
      if (!exemptDatesByUser.has(ep.user_id)) exemptDatesByUser.set(ep.user_id, new Set())
      const s = new Date(ep.start_date)
      const e = new Date(ep.end_date)
      for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
        exemptDatesByUser.get(ep.user_id)!.add(toLocalISODate(d))
      }
    }

    const records = rows.map((r) => {
      const p = profileMap.get(r.user_id)
      const name = p?.full_name?.trim() || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "Unknown"

      const derivedStatus = deriveUnifiedAttendanceStatus({
        record: r,
        isHoliday: holidaySet.has(r.date),
        isOnLeave: leaveDatesByUser.get(r.user_id)?.has(r.date) ?? false,
        isExempted: Boolean(p?.attendance_exempt) || (exemptDatesByUser.get(r.user_id)?.has(r.date) ?? false),
        recordDate: r.date,
      })

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
        waiver_reason: r.waiver_reason,
        updated_at: r.updated_at,
        selfie_url: r.selfie_url ?? null,
        selfie_out_url: r.selfie_out_url ?? null,
        face_match_confidence: r.face_match_confidence ?? null,
        face_verified: r.face_verified ?? null,
        location_verified: r.location_verified ?? null,
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        site_id: r.site_id ?? null,
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
            .select("user_id")
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
        const onLeaveSet = new Set((dayLeaveRows as { user_id: string }[]).map((r) => r.user_id))
        const exemptPeriodSet = new Set((dayExemptRows as { user_id: string }[]).map((r) => r.user_id))

        for (const p of missing) {
          const name = p.full_name?.trim() || [p.first_name, p.last_name].filter(Boolean).join(" ") || "Unknown"
          const derivedStatus = deriveUnifiedAttendanceStatus({
            record: null,
            isHoliday,
            isOnLeave: onLeaveSet.has(p.id),
            isExempted: Boolean(p.attendance_exempt) || exemptPeriodSet.has(p.id),
            recordDate: day,
          })
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
            waiver_reason: null,
            updated_at: null,
            selfie_url: null,
            selfie_out_url: null,
            face_match_confidence: null,
            face_verified: null,
            location_verified: null,
            latitude: null,
            longitude: null,
            site_id: null,
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

    const parsed = CreateSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 })
    }

    const { user_id, date, clock_in, clock_out, waived, waiver_reason } = parsed.data
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
    const status =
      parsed.data.status ??
      (waived
        ? "waiver"
        : deriveUnifiedAttendanceStatus({
            record: { clock_in, clock_out, waived: false },
            recordDate: date,
          }))

    if (clock_in && clock_out && clock_out <= clock_in) {
      return NextResponse.json({ error: "Clock out must be after clock in" }, { status: 400 })
    }
    if (!waived && !clock_in && !clock_out) {
      return NextResponse.json({ error: "Provide both clock in and clock out before saving" }, { status: 400 })
    }
    if ((clock_in && !clock_out) || (!clock_in && clock_out)) {
      return NextResponse.json({ error: "Clock in and clock out must be provided together" }, { status: 400 })
    }

    const insert: Record<string, unknown> = { user_id, date, status, source: "manual" }
    if (clock_in) {
      insert.clock_in = clock_in
      insert.clock_in_source = "manual"
    }
    if (clock_out) {
      insert.clock_out = clock_out
      insert.clock_out_source = "manual"
    }
    if (waived !== undefined) insert.waived = waived
    if (waiver_reason !== undefined) insert.waiver_reason = waiver_reason

    if (clock_in && clock_out) {
      const inMs = new Date(`${date}T${clock_in}Z`).getTime()
      const outMs = new Date(`${date}T${clock_out}Z`).getTime()
      insert.total_hours = Math.max(0, (outMs - inMs) / (1000 * 60 * 60))
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

    return NextResponse.json({ data: created, message: "Record created" }, { status: 201 })
  } catch (error) {
    log.error({ err: String(error) }, "Error in POST /api/admin/hr/attendance/records")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
