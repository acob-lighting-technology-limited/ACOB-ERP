import { NextRequest, NextResponse } from "next/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getClientId, rateLimit } from "@/lib/rate-limit"
import { getWorkdaysInMonth, toLocalISODate } from "@/lib/hr/attendance-utils"
import { deductionForStatus, deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"

type AttendanceRow = {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  waived: boolean
  waiver_reason: string | null
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

  const { data: records } = await dataClient
    .from("attendance_records")
    .select("id, date, clock_in, clock_out, total_hours, status, source, waived, waiver_reason, updated_at")
    .eq("user_id", userId)
    .gte("date", `${yearMonth}-01`)
    .lte("date", `${yearMonth}-31`)
    .returns<AttendanceRow[]>()

  const { data: leaves } = await dataClient
    .from("leave_requests")
    .select("start_date, end_date, status")
    .eq("user_id", userId)
    .eq("status", "approved")
    .lte("start_date", `${yearMonth}-31`)
    .gte("end_date", `${yearMonth}-01`)

  const { data: periods } = await dataClient
    .from("attendance_exempt_periods")
    .select("start_date, end_date")
    .eq("user_id", userId)
    .lte("start_date", `${yearMonth}-31`)
    .gte("end_date", `${yearMonth}-01`)

  const { data: holidays } = await dataClient
    .from("holiday_calendar")
    .select("holiday_date")
    .gte("holiday_date", `${yearMonth}-01`)
    .lte("holiday_date", `${yearMonth}-31`)
    .returns<HolidayRow[]>()

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
  for (const r of records || []) recordsByDate.set(r.date, r)
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
      })
      return {
        date,
        record: rec,
        status,
        deduction: rec?.waived ? 0 : deductionForStatus(status, rec?.clock_in, rec?.clock_out),
      }
    })

  return NextResponse.json({ data: rows })
}
