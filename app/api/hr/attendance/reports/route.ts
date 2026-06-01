import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { normalizeDepartmentName } from "@/shared/departments"
import { missedHours, dayCredit, toLocalISODate, toLocalYearMonth, getWorkdaysInMonth } from "@/lib/hr/attendance-utils"
import { deriveUnifiedAttendanceStatus } from "@/lib/hr/attendance-status"
import { logger } from "@/lib/logger"

const log = logger("hr-attendance-reports-api")

type AttendanceRow = {
  user_id: string | null
  date?: string | null
  status?: string | null
  total_hours?: number | null
  clock_in?: string | null
  clock_out?: string | null
  waived?: boolean | null
}

type ProfileRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  employee_number?: string | null
  department?: string | null
  attendance_exempt?: boolean | null
  attendance_exempt_until?: string | null
}

type LeaveRow = {
  user_id: string
  start_date: string
  end_date: string
  status: string
}

type HolidayRow = {
  holiday_date: string
}
type ExemptPeriodRow = {
  user_id: string
  start_date: string
  end_date: string
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const contextResult = await requireAccessContextV2()
    if (!contextResult.ok) return contextResult.response
    const routeAccess = enforceRouteAccessV2(contextResult.context, "hr.main")
    if (!routeAccess.ok) return routeAccess.response
    if (routeAccess.dataScope === "none") {
      return NextResponse.json({ data: [], departments: [] })
    }

    const params = request.nextUrl.searchParams
    const startDate = params.get("start_date")
    const endDate = params.get("end_date")
    const requestedDepartment = normalizeDepartmentName(String(params.get("department") || "all"))
    const requestedUserId = String(params.get("user_id") || "").trim()

    const dataClient = getServiceRoleClientOrFallback(supabase)

    const scopedDepartmentSet =
      routeAccess.dataScope === "all"
        ? null
        : new Set(routeAccess.dataScope.map((department) => normalizeDepartmentName(department)))

    // Fetch all non-exempt profiles in scope first (not just those with records)
    let allProfiles: ProfileRow[] = []
    {
      const profileQuery = dataClient
        .from("profiles")
        .select("id, first_name, last_name, employee_number, department, attendance_exempt, attendance_exempt_until")
        .eq("employment_status", "active")
      const { data, error } = await profileQuery.returns<ProfileRow[]>()
      if (!error && data) {
        allProfiles = data
      } else {
        // Backward compatibility: if new columns are missing, fall back progressively.
        const { data: fallbackData, error: fallbackError } = await dataClient
          .from("profiles")
          .select("id, first_name, last_name, employee_number, department, attendance_exempt")
          .eq("employment_status", "active")
          .returns<ProfileRow[]>()
        if (!fallbackError) {
          allProfiles = fallbackData || []
        } else {
          const { data: legacyData, error: legacyError } = await dataClient
            .from("profiles")
            .select("id, first_name, last_name, department, attendance_exempt")
            .eq("employment_status", "active")
            .returns<ProfileRow[]>()
          if (legacyError) {
            return NextResponse.json({ error: legacyError.message }, { status: 500 })
          }
          allProfiles = legacyData || []
        }
      }
    }

    const allowedProfiles = (allProfiles || []).filter((profile) => {
      if (requestedUserId && profile.id !== requestedUserId) return false
      const department = normalizeDepartmentName(String(profile.department || ""))
      if (scopedDepartmentSet && !scopedDepartmentSet.has(department)) return false
      if (requestedDepartment !== "all" && department !== requestedDepartment) return false
      return true
    })

    if (allowedProfiles.length === 0) {
      return NextResponse.json({ data: [], departments: [] })
    }

    const allowedProfileIds = allowedProfiles.map((p) => p.id)

    // Workdays in the selected period up to today
    const todayIso = toLocalISODate()
    const ym = startDate?.slice(0, 7) ?? toLocalYearMonth()
    const periodWorkdays = getWorkdaysInMonth(ym).filter(
      (d) => (!startDate || d >= startDate) && (!endDate || d <= endDate) && d <= todayIso
    )

    if (periodWorkdays.length === 0) {
      return NextResponse.json({ data: [], departments: [] })
    }

    // Fetch attendance records for allowed employees in date range
    let attendanceQuery = dataClient
      .from("attendance_records")
      .select("user_id, date, status, total_hours, clock_in, clock_out, waived")
      .in("user_id", allowedProfileIds)
    if (startDate) attendanceQuery = attendanceQuery.gte("date", startDate)
    if (endDate) attendanceQuery = attendanceQuery.lte("date", endDate)

    const { data: attendanceRows, error: attendanceError } = await attendanceQuery.returns<AttendanceRow[]>()
    if (attendanceError) {
      return NextResponse.json({ error: attendanceError.message }, { status: 500 })
    }

    // Fetch approved leave requests that overlap the selected date range
    let leaveQuery = dataClient
      .from("leave_requests")
      .select("user_id, start_date, end_date, status")
      .in("user_id", allowedProfileIds)
      .eq("status", "approved")
    if (startDate) leaveQuery = leaveQuery.lte("start_date", endDate ?? startDate)
    if (endDate) leaveQuery = leaveQuery.gte("end_date", startDate ?? endDate)

    const { data: leaveRows } = await leaveQuery.returns<LeaveRow[]>()

    const exemptPeriodSet = new Set<string>()
    {
      let periodQuery = dataClient
        .from("attendance_exempt_periods")
        .select("user_id, start_date, end_date")
        .in("user_id", allowedProfileIds)
      if (startDate) periodQuery = periodQuery.lte("start_date", endDate ?? startDate)
      if (endDate) periodQuery = periodQuery.gte("end_date", startDate ?? endDate)
      const { data: periodRows } = await periodQuery.returns<ExemptPeriodRow[]>()
      for (const period of periodRows || []) {
        const start = new Date(period.start_date)
        const end = new Date(period.end_date)
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          exemptPeriodSet.add(`${period.user_id}:${toLocalISODate(d)}`)
        }
      }
    }

    // Fetch org-wide holidays in selected range
    const holidaySet = new Set<string>()
    {
      let holidayQuery = dataClient.from("holiday_calendar").select("holiday_date")
      if (startDate) holidayQuery = holidayQuery.gte("holiday_date", startDate)
      if (endDate) holidayQuery = holidayQuery.lte("holiday_date", endDate)
      const { data: holidayRows } = await holidayQuery.returns<HolidayRow[]>()
      for (const holiday of holidayRows || []) holidaySet.add(holiday.holiday_date)
    }

    // Build set of (user_id, date) covered by approved leave
    const onLeaveSet = new Set<string>()
    for (const lr of leaveRows ?? []) {
      const start = new Date(lr.start_date)
      const end = new Date(lr.end_date)
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        onLeaveSet.add(`${lr.user_id}:${toLocalISODate(d)}`)
      }
    }

    // Build per-employee record map keyed by date
    const recordsByEmployee = new Map<string, Map<string, AttendanceRow>>()
    for (const row of attendanceRows ?? []) {
      if (!row.user_id || !row.date) continue
      if (!recordsByEmployee.has(row.user_id)) recordsByEmployee.set(row.user_id, new Map())
      recordsByEmployee.get(row.user_id)!.set(row.date, row)
    }

    // Calculate workday-based summaries — missing days count as absent
    const summaries = allowedProfiles.map((profile) => {
      const empRecords = recordsByEmployee.get(profile.id) ?? new Map<string, AttendanceRow>()
      let present_days = 0,
        late_days = 0,
        incomplete_days = 0,
        absent_days = 0,
        exempted_days = 0,
        total_hours = 0,
        total_missed_hours = 0,
        waived_days = 0,
        half_day_days = 0,
        leave_days = 0,
        holiday_days = 0,
        attendance_credits = 0
      let available_days = 0

      for (const workday of periodWorkdays) {
        if (holidaySet.has(workday)) {
          holiday_days++
          attendance_credits += 1.0
          continue
        }
        if (onLeaveSet.has(`${profile.id}:${workday}`)) {
          leave_days++
          attendance_credits += 1.0
          continue
        }
        const rec = empRecords.get(workday)
        // Skip today if still in progress (clocked in, not yet out) — don't score an unfinished day
        if (workday === todayIso && rec?.clock_in && !rec?.clock_out) continue

        available_days++
        const isExempted = Boolean(profile.attendance_exempt) || exemptPeriodSet.has(`${profile.id}:${workday}`)
        if (isExempted) {
          exempted_days++
          attendance_credits += 1.0
          continue
        }

        const derived = deriveUnifiedAttendanceStatus({ record: rec, recordDate: workday })
        if (!rec) {
          absent_days++
          total_missed_hours += 9
          continue
        }

        if (derived === "waiver") {
          waived_days++
          attendance_credits += 1.0
        } else if (derived === "present" || derived === "late") {
          derived === "late" ? late_days++ : present_days++
          attendance_credits += dayCredit(derived, rec.clock_in, rec.clock_out)
          total_hours += Number(rec.total_hours ?? 0)
          total_missed_hours += missedHours(rec.clock_in, rec.clock_out)
        } else if (derived === "half_day") {
          half_day_days++
          attendance_credits += 0.5
          total_hours += 4.5
          total_missed_hours += 4.5
        } else if (derived === "incomplete") {
          incomplete_days++
        } else {
          absent_days++
          total_missed_hours += 9
        }
      }

      const total_working_days = available_days + leave_days + holiday_days
      const attendance_rate =
        total_working_days > 0 ? Math.round((attendance_credits / total_working_days) * 10000) / 100 : 0

      const name = `${String(profile.first_name || "").trim()} ${String(profile.last_name || "").trim()}`.trim()
      return {
        user_id: profile.id,
        employee_no: String(profile.employee_number || "").trim(),
        user_name: name,
        department: String(profile.department || "N/A"),
        total_days: total_working_days,
        present_days,
        late_days,
        incomplete_days,
        half_day_days,
        exempted_days,
        absent_days,
        waived_days,
        leave_days,
        holiday_days,
        attendance_credits: Math.round(attendance_credits * 100) / 100,
        total_hours,
        total_missed_hours: Math.round(total_missed_hours * 10) / 10,
        attendance_rate,
        attendance_exempt: Boolean(profile.attendance_exempt),
      }
    })

    const visibleDepartments = Array.from(
      new Set(allowedProfiles.map((profile) => String(profile.department || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ data: summaries, departments: visibleDepartments })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load attendance reports")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
