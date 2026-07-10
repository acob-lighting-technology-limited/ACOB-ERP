import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"
import { toLocalISODate } from "@/lib/utils/date"
import { normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

type AttendanceRow = { id: string; user_id: string }
type ReviewRow = { id: string; user_id: string }
type LocationRow = { office_location: string | null; department: string | null; employment_status?: string | null }

// Shared between /admin/hr and /dept/[id]/hr — department scope is resolved
// server-side from getScopedDepartments() (no client-side scope derivation).
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const depts = getScopedDepartments(scope)
  const hasDeptFilter = depts !== null && depts.length > 0
  if (depts !== null && depts.length === 0) {
    return NextResponse.json({
      pendingLeaveRequests: 0,
      todayAttendance: 0,
      upcomingReviews: 0,
      totalEmployees: 0,
      totalDepartments: 0,
      totalOfficeLocations: 0,
    })
  }

  let pendingLeaveCount = 0
  try {
    const queueRes = await fetch(new URL("/api/hr/leave/queue", request.nextUrl.origin), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    })
    const queuePayload = await queueRes.json()
    if (queueRes.ok) pendingLeaveCount = Array.isArray(queuePayload.data) ? queuePayload.data.length : 0
  } catch {
    pendingLeaveCount = 0
  }

  const scopedUserIds = hasDeptFilter
    ? ((await db.from("profiles").select("id").in("department", depts!)).data?.map((r) => r.id) ?? [])
    : []

  const today = toLocalISODate()
  const { data: attendance } = await db
    .from("attendance_records")
    .select("id, user_id")
    .eq("date", today)
    .returns<AttendanceRow[]>()
  const attendanceRows = hasDeptFilter ? attendance?.filter((row) => scopedUserIds.includes(row.user_id)) : attendance

  const { data: reviews } = await db
    .from("performance_reviews")
    .select("id, user_id")
    .eq("status", "draft")
    .returns<ReviewRow[]>()
  const reviewRows = hasDeptFilter ? reviews?.filter((row) => scopedUserIds.includes(row.user_id)) : reviews

  let employeeCountQuery = db.from("profiles").select("*", { count: "exact", head: true })
  if (hasDeptFilter) employeeCountQuery = employeeCountQuery.in("department", depts!)
  const { count: employeeCount } = await employeeCountQuery

  let departmentCountQuery = db.from("departments").select("*", { count: "exact", head: true })
  if (hasDeptFilter) departmentCountQuery = departmentCountQuery.in("name", depts!)
  const { count: departmentCount } = await departmentCountQuery

  const { data: locations } = await db.from("profiles").select("office_location, department, employment_status")
  const deptSet = new Set((depts ?? []).map((d) => normalizeDepartmentName(d)))
  const locationRows = ((locations ?? []) as LocationRow[]).filter((row) => {
    if (!isAssignableEmploymentStatus(row.employment_status, { allowLegacyNullStatus: false })) return false
    if (!hasDeptFilter) return true
    return deptSet.has(normalizeDepartmentName(String(row.department || "")))
  })

  return NextResponse.json({
    pendingLeaveRequests: pendingLeaveCount,
    todayAttendance: attendanceRows?.length || 0,
    upcomingReviews: reviewRows?.length || 0,
    totalEmployees: employeeCount || 0,
    totalDepartments: departmentCount || 0,
    totalOfficeLocations: new Set(locationRows.map((l) => (l.office_location || "").trim()).filter(Boolean)).size,
  })
}
