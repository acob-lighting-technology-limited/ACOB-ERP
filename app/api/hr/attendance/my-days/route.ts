import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import {
  getWorkdaysInMonth,
  monthBounds,
  toLocalISODate,
  toLocalYearMonth,
  loadAttendancePolicy,
} from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { loadDayContext } from "@/lib/hr/attendance-day-context"

type AttendanceRow = {
  id: string
  date: string
  clock_in: string | null
  clock_out: string | null
  total_hours: number | null
  status: string
  source: string | null
  waived: boolean
  created_at?: string | null
  updated_at?: string | null
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const policy = await loadAttendancePolicy(supabase)
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
  const { start: monthStart, end: monthEnd } = monthBounds(yearMonth)

  const { data: profile } = await dataClient.from("profiles").select("attendance_exempt").eq("id", userId).maybeSingle()
  const { data: records, error: recordsError } = await dataClient
    .from("attendance_records")
    .select("id, date, clock_in, clock_out, total_hours, status, source, waived, created_at, updated_at")
    .eq("user_id", userId)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .returns<AttendanceRow[]>()
  if (recordsError) return NextResponse.json({ error: recordsError.message }, { status: 500 })

  const ctx = await loadDayContext(dataClient, { userIds: [userId], start: monthStart, end: monthEnd })

  const recordsByDate = new Map<string, AttendanceRow>()
  for (const record of records || []) {
    const existing = recordsByDate.get(record.date)
    if (!existing || shouldPreferAttendanceRecord(record, existing)) {
      recordsByDate.set(record.date, record)
    }
  }

  const today = toLocalISODate()
  const data = getWorkdaysInMonth(yearMonth)
    .filter((d) => d <= today)
    .map((date) => {
      const rec = recordsByDate.get(date) || null
      const closeTime = ctx.earlyCloseTime(date)
      const lateRes = ctx.lateResumptionTime(date)
      const status = deriveUnifiedAttendanceStatus(
        {
          record: rec,
          isHoliday: ctx.isHoliday(date),
          isOnLeave: ctx.isOnLeave(userId, date),
          isOnUnpaidLeave: ctx.isOnUnpaidLeave(userId, date),
          isExempted: Boolean(profile?.attendance_exempt) || ctx.isExempt(userId, date),
          recordDate: date,
          earlyClosure: closeTime ? { closeTime } : null,
          lateResumption: lateRes ? { resumptionTime: lateRes } : null,
        },
        policy
      )
      return { date, record: rec, status }
    })

  return NextResponse.json({ data })
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
