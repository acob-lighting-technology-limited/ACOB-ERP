import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getWorkdaysInMonth, monthBounds, toLocalISODate } from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
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
  waiver_reason: string | null
  created_at?: string | null
  updated_at?: string | null
}
type HolidayRow = {
  holiday_date: string
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
      "id, date, clock_in, clock_out, total_hours, status, source, clock_in_source, clock_out_source, waived, waiver_reason, created_at, updated_at"
    )
    .eq("user_id", userId)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .returns<AttendanceRow[]>()
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const { data: leaves, error: leavesError } = await dataClient
    .from("leave_requests")
    .select("start_date, end_date, status")
    .eq("user_id", userId)
    .eq("status", "approved")
    .lte("start_date", monthEnd)
    .gte("end_date", monthStart)
  if (leavesError) return NextResponse.json({ error: leavesError.message }, { status: 500 })

  const { data: periods, error: periodsError } = await dataClient
    .from("attendance_exempt_periods")
    .select("start_date, end_date")
    .eq("user_id", userId)
    .lte("start_date", monthEnd)
    .gte("end_date", monthStart)
  if (periodsError) return NextResponse.json({ error: periodsError.message }, { status: 500 })

  const { data: holidays, error: holidaysError } = await dataClient
    .from("holiday_calendar")
    .select("holiday_date")
    .gte("holiday_date", monthStart)
    .lte("holiday_date", monthEnd)
    .returns<HolidayRow[]>()
  if (holidaysError) return NextResponse.json({ error: holidaysError.message }, { status: 500 })

  const leaveDates = new Set<string>()
  for (const lr of leaves || []) {
    const s = new Date(lr.start_date)
    const e = new Date(lr.end_date)
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) leaveDates.add(toLocalISODate(d))
  }

  const exemptDates = new Set<string>()
  for (const p of periods || []) {
    const s = new Date(p.start_date)
    const e = new Date(p.end_date)
    for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) exemptDates.add(toLocalISODate(d))
  }

  const recordsByDate = new Map<string, AttendanceRow>()
  for (const record of records || []) {
    const existing = recordsByDate.get(record.date)
    if (!existing || shouldPreferAttendanceRecord(record, existing)) {
      recordsByDate.set(record.date, record)
    }
  }
  const holidayDates = new Set<string>((holidays || []).map((h) => h.holiday_date))

  const today = toLocalISODate()
  const rows = getWorkdaysInMonth(yearMonth)
    .filter((d) => d <= today)
    .map((date) => {
      const rec = recordsByDate.get(date) || null
      const status = deriveUnifiedAttendanceStatus({
        record: rec,
        isHoliday: holidayDates.has(date),
        isOnLeave: leaveDates.has(date),
        isExempted: exemptHint || Boolean(profile?.attendance_exempt) || exemptDates.has(date),
        recordDate: date,
      })
      return { date, record: rec, status }
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
