import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { getDepartmentAliases } from "@/shared/departments"
import type { WeeklyReport } from "@/lib/export-utils"

export const dynamic = "force-dynamic"

function expandDepartmentScope(departments: string[]) {
  const scoped = new Set<string>()
  departments.forEach((department) => {
    getDepartmentAliases(department).forEach((alias) => scoped.add(alias))
  })
  return Array.from(scoped)
}

type TrackerStatus = { id: string; department: string; status: string }

// Org-wide (all-department) submitted weekly reports for a given week/year, plus
// the matching action-tracker status overlay. Matches the page's existing
// behaviour: unscoped by caller department (any admin-like/lead who can reach
// this screen sees all departments' reports for the meeting week).
export async function GET(request: NextRequest) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const week = Number(request.nextUrl.searchParams.get("week"))
  const year = Number(request.nextUrl.searchParams.get("year"))
  if (!Number.isFinite(week) || !Number.isFinite(year)) {
    return NextResponse.json({ error: "Invalid week/year" }, { status: 400 })
  }

  const db = getServiceRoleClientOrFallback(supabase)

  const { data: employeeData } = await db.from("profiles").select("department").not("department", "is", null)
  const departments = Array.from(new Set((employeeData ?? []).map((row) => row.department).filter(Boolean))) as string[]

  const { data, error } = await db
    .from("weekly_reports")
    .select(
      "id, department, week_number, year, work_done, tasks_new_week, challenges, status, user_id, created_at, updated_at, profiles(first_name, last_name)"
    )
    .eq("status", "submitted")
    .eq("week_number", week)
    .eq("year", year)
    .order("department", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: actions, error: actionsError } = await db
    .from("tasks")
    .select("id, department, status")
    .eq("category", "weekly_action")
    .eq("week_number", week)
    .eq("year", year)
    .in("department", expandDepartmentScope(departments))

  return NextResponse.json({
    reports: (data ?? []) as WeeklyReport[],
    trackingData: actionsError ? [] : ((actions ?? []) as TrackerStatus[]),
  })
}
