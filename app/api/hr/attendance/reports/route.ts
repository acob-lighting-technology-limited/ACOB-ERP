import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { enforceRouteAccessV2, requireAccessContextV2 } from "@/lib/admin/api-guard-v2"
import { normalizeDepartmentName } from "@/shared/departments"
import { logger } from "@/lib/logger"

const log = logger("hr-attendance-reports-api")

type AttendanceRow = {
  user_id: string | null
  status?: string | null
  total_hours?: number | null
}

type ProfileRow = {
  id: string
  first_name?: string | null
  last_name?: string | null
  department?: string | null
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

    const dataClient = getServiceRoleClientOrFallback(supabase)
    let attendanceQuery = dataClient.from("attendance_records").select("user_id, status, total_hours")
    if (startDate) attendanceQuery = attendanceQuery.gte("date", startDate)
    if (endDate) attendanceQuery = attendanceQuery.lte("date", endDate)

    const { data: attendanceRows, error: attendanceError } = await attendanceQuery.returns<AttendanceRow[]>()
    if (attendanceError) {
      return NextResponse.json({ error: attendanceError.message }, { status: 500 })
    }

    const userIds = Array.from(
      new Set((attendanceRows || []).map((row) => row.user_id).filter((value): value is string => Boolean(value)))
    )
    if (userIds.length === 0) {
      return NextResponse.json({ data: [], departments: [] })
    }

    const { data: profiles, error: profileError } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, department")
      .in("id", userIds)
      .returns<ProfileRow[]>()
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    const scopedDepartmentSet =
      routeAccess.dataScope === "all"
        ? null
        : new Set(routeAccess.dataScope.map((department) => normalizeDepartmentName(department)))

    const allowedProfiles = (profiles || []).filter((profile) => {
      const department = normalizeDepartmentName(String(profile.department || ""))
      if (scopedDepartmentSet && !scopedDepartmentSet.has(department)) return false
      if (requestedDepartment !== "all" && department !== requestedDepartment) return false
      return true
    })

    const allowedProfileIds = new Set(allowedProfiles.map((profile) => profile.id))
    const profileById = new Map(allowedProfiles.map((profile) => [profile.id, profile] as const))
    const summaryMap = new Map<
      string,
      {
        user_id: string
        user_name: string
        department: string
        total_days: number
        present_days: number
        late_days: number
        absent_days: number
        total_hours: number
        attendance_rate: number
      }
    >()

    for (const row of attendanceRows || []) {
      if (!row.user_id || !allowedProfileIds.has(row.user_id)) continue
      const profile = profileById.get(row.user_id)
      if (!profile) continue

      const existing = summaryMap.get(row.user_id) || {
        user_id: row.user_id,
        user_name: `${String(profile.first_name || "").trim()} ${String(profile.last_name || "").trim()}`.trim(),
        department: String(profile.department || "N/A"),
        total_days: 0,
        present_days: 0,
        late_days: 0,
        absent_days: 0,
        total_hours: 0,
        attendance_rate: 0,
      }

      existing.total_days += 1
      existing.total_hours += Number(row.total_hours || 0)
      if (row.status === "present") existing.present_days += 1
      else if (row.status === "late") existing.late_days += 1
      else if (row.status === "absent") existing.absent_days += 1

      summaryMap.set(row.user_id, existing)
    }

    const summaries = Array.from(summaryMap.values()).map((item) => ({
      ...item,
      attendance_rate: item.total_days > 0 ? Math.round((item.present_days / item.total_days) * 100) : 0,
    }))

    const visibleDepartments = Array.from(
      new Set(allowedProfiles.map((profile) => String(profile.department || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b))

    return NextResponse.json({ data: summaries, departments: visibleDepartments })
  } catch (error) {
    log.error({ err: String(error) }, "Failed to load attendance reports")
    return NextResponse.json({ error: "An error occurred" }, { status: 500 })
  }
}
