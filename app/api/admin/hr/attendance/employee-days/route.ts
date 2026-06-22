import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getWorkdaysInMonth, monthBounds, toLocalISODate } from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { loadDayContext } from "@/lib/hr/attendance-day-context"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

type AttendanceRow = {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  clock_in_source: string | null
  clock_out_source: string | null
  waived: boolean
  created_at?: string | null
  updated_at?: string | null
  editor_first_name?: string | null
}
export async function GET(request: NextRequest) {
  const rl = await rateLimit(`admin-attendance-employee-days:${getClientId(request)}`, { limit: 30, windowSec: 60 })
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult

  const userId = String(request.nextUrl.searchParams.get("user_id") || "")
  const yearMonth = String(request.nextUrl.searchParams.get("year_month") || "")
  const exemptHint = request.nextUrl.searchParams.get("exempt_hint") === "1"
  if (!userId || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: "user_id and year_month are required" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const { start: monthStart, end: monthEnd } = monthBounds(yearMonth)

  // Validate target user is within this admin/lead's scope
  const depts = getScopedDepartments(scope)
  if (depts !== null) {
    const { data: targetProfile } = await dataClient
      .from("profiles")
      .select("department")
      .eq("id", userId)
      .maybeSingle()
    if (!targetProfile || !depts.includes(targetProfile.department || "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
  }
  const { data: profile } = await dataClient.from("profiles").select("attendance_exempt").eq("id", userId).maybeSingle()

  const { data: records, error: recordsError } = await dataClient
    .from("attendance_records")
    .select(
      "id, date, clock_in, clock_out, total_hours, status, source, clock_in_source, clock_out_source, waived, created_at, updated_at"
    )
    .eq("user_id", userId)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .returns<AttendanceRow[]>()
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const ctx = await loadDayContext(dataClient, { userIds: [userId], start: monthStart, end: monthEnd })

  // ── Provenance attribution: who edited each record + who set holiday/leave/exempt days ──
  const recordIds = (records || []).map((r) => r.id).filter(Boolean)
  const expandRange = (start: string, end: string): string[] => {
    const out: string[] = []
    const e = new Date(end)
    for (let d = new Date(start); d <= e; d.setDate(d.getDate() + 1)) out.push(toLocalISODate(d))
    return out
  }

  const [{ data: holRows }, { data: lvRows }, { data: exRows }, auditLogs] = await Promise.all([
    dataClient
      .from("holiday_calendar")
      .select("holiday_date, created_by")
      .gte("holiday_date", monthStart)
      .lte("holiday_date", monthEnd),
    dataClient
      .from("leave_requests")
      .select("start_date, end_date, approved_by")
      .eq("user_id", userId)
      .eq("status", "approved")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    dataClient
      .from("attendance_exempt_periods")
      .select("start_date, end_date, created_by")
      .eq("user_id", userId)
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart),
    recordIds.length > 0
      ? dataClient
          .from("audit_logs")
          .select("entity_id, user_id, created_at")
          .eq("entity_type", "attendance_record")
          .in("entity_id", recordIds)
          .order("created_at", { ascending: false })
          .then((r) => r.data ?? [])
      : Promise.resolve([] as Array<{ entity_id: string; user_id: string }>),
  ])

  // Per-day manual actor (priority: holiday > leave > exempt).
  const holBy = new Map<string, string>()
  for (const h of (holRows ?? []) as Array<{ holiday_date: string; created_by: string | null }>) {
    if (h.created_by) holBy.set(h.holiday_date, h.created_by)
  }
  const lvBy = new Map<string, string>()
  for (const l of (lvRows ?? []) as Array<{ start_date: string; end_date: string; approved_by: string | null }>) {
    if (l.approved_by) for (const d of expandRange(l.start_date, l.end_date)) lvBy.set(d, l.approved_by)
  }
  const exBy = new Map<string, string>()
  for (const p of (exRows ?? []) as Array<{ start_date: string; end_date: string; created_by: string | null }>) {
    if (p.created_by) for (const d of expandRange(p.start_date, p.end_date)) exBy.set(d, p.created_by)
  }

  // Latest editor per record from audit logs.
  const editorIdByRecordId = new Map<string, string>()
  for (const lg of auditLogs as Array<{ entity_id: string; user_id: string }>) {
    if (!editorIdByRecordId.has(lg.entity_id)) editorIdByRecordId.set(lg.entity_id, lg.user_id)
  }

  // Resolve every actor id → first name in one query.
  const actorIds = [
    ...new Set([...editorIdByRecordId.values(), ...holBy.values(), ...lvBy.values(), ...exBy.values()].filter(Boolean)),
  ]
  const firstNameById = new Map<string, string>()
  if (actorIds.length > 0) {
    const { data: actorProfiles } = await dataClient
      .from("profiles")
      .select("id, first_name, full_name")
      .in("id", actorIds)
    for (const p of actorProfiles ?? []) {
      firstNameById.set(p.id, p.first_name || p.full_name?.split(" ")[0] || "—")
    }
  }
  const manualByDate = (date: string): string | null => {
    const id = holBy.get(date) ?? lvBy.get(date) ?? exBy.get(date)
    return id ? (firstNameById.get(id) ?? null) : null
  }

  const recordsByDate = new Map<string, AttendanceRow>()
  for (const record of records || []) {
    const existing = recordsByDate.get(record.date)
    if (!existing || shouldPreferAttendanceRecord(record, existing)) {
      const editorUserId = editorIdByRecordId.get(record.id)
      const editorFirstName = editorUserId ? (firstNameById.get(editorUserId) ?? null) : null
      recordsByDate.set(record.date, { ...record, editor_first_name: editorFirstName })
    }
  }

  const today = toLocalISODate()
  const rows = getWorkdaysInMonth(yearMonth)
    .filter((d) => d <= today)
    .map((date) => {
      const rec = recordsByDate.get(date) || null
      const status = deriveUnifiedAttendanceStatus({
        record: rec,
        isHoliday: ctx.isHoliday(date),
        isOnLeave: ctx.isOnLeave(userId, date),
        isExempted: exemptHint || Boolean(profile?.attendance_exempt) || ctx.isExempt(userId, date),
        recordDate: date,
      })
      return { date, record: rec, status, manual_by: manualByDate(date) }
    })

  return NextResponse.json({ data: rows })
}

function attendanceRecordScore(record: AttendanceRow): number {
  if (record.clock_in && record.clock_out) return 4
  if (record.clock_in || record.clock_out) return 3
  if (record.waived) return 2
  if (record.status && record.status !== "absent") return 1
  return 0
}

function shouldPreferAttendanceRecord(candidate: AttendanceRow, current: AttendanceRow): boolean {
  const candidateScore = attendanceRecordScore(candidate)
  const currentScore = attendanceRecordScore(current)
  if (candidateScore !== currentScore) return candidateScore > currentScore

  const candidateTime = Date.parse(candidate.updated_at || candidate.created_at || "")
  const currentTime = Date.parse(current.updated_at || current.created_at || "")
  if (Number.isNaN(candidateTime)) return false
  if (Number.isNaN(currentTime)) return true
  return candidateTime > currentTime
}
