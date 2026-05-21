import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getWorkdaysInMonth, toLocalISODate, toLocalYearMonth } from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"

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

type HolidayRow = { holiday_date: string }

function expandIsoDateRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split("-").map(Number)
  const [ey, em, ed] = endDate.split("-").map(Number)
  const start = new Date(Date.UTC(sy, sm - 1, sd))
  const end = new Date(Date.UTC(ey, em - 1, ed))
  const days: string[] = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, "0")
    const day = String(d.getUTCDate()).padStart(2, "0")
    days.push(`${y}-${m}-${day}`)
  }
  return days
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const yearMonth = String(request.nextUrl.searchParams.get("year_month") || toLocalYearMonth())
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: "year_month is invalid" }, { status: 400 })
  }

  const dataClient = getServiceRoleClientOrFallback(supabase)
  const userId = user.id

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
    .select("start_date, end_date")
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
    .eq("location", "all")
    .gte("holiday_date", `${yearMonth}-01`)
    .lte("holiday_date", `${yearMonth}-31`)
    .returns<HolidayRow[]>()

  const leaveDates = new Set<string>()
  for (const lr of leaves || []) {
    for (const date of expandIsoDateRange(lr.start_date, lr.end_date)) leaveDates.add(date)
  }
  const exemptDates = new Set<string>()
  for (const p of periods || []) {
    for (const date of expandIsoDateRange(p.start_date, p.end_date)) exemptDates.add(date)
  }
  const holidayDates = new Set<string>((holidays || []).map((h) => h.holiday_date))
  const recordsByDate = new Map<string, AttendanceRow>((records || []).map((r) => [r.date, r]))

  const today = toLocalISODate()
  const data = getWorkdaysInMonth(yearMonth)
    .filter((d) => d <= today)
    .map((date) => {
      const rec = recordsByDate.get(date) || null
      const status = deriveUnifiedAttendanceStatus({
        record: rec,
        isHoliday: holidayDates.has(date),
        isOnLeave: leaveDates.has(date),
        isExempted: Boolean(profile?.attendance_exempt) || exemptDates.has(date),
      })
      return { date, record: rec, status }
    })

  return NextResponse.json({ data })
}
