import { NextRequest, NextResponse } from "next/server"
import { requireApiAdminScope } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { fetchWeeklyReportLockState } from "@/lib/weekly-report-lock"
import { getDepartmentAliases, normalizeDepartmentName } from "@/shared/departments"

export const dynamic = "force-dynamic"

// Deletes a weekly report after re-checking the week isn't locked (server-side,
// avoiding the check-then-delete race the client-only version had), and that
// the caller may edit this report's department.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  if (!scope.isAdminLike && !scope.isDepartmentLead) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { id } = await params
  const db = getServiceRoleClientOrFallback(supabase)

  const { data: report, error: fetchError } = await db
    .from("weekly_reports")
    .select("week_number, year, department")
    .eq("id", id)
    .single()
  if (fetchError || !report) {
    return NextResponse.json({ error: fetchError?.message ?? "Report not found" }, { status: 404 })
  }

  const normalizedRole = (scope.role || "").toLowerCase()
  const isGlobalReportsEditor =
    normalizedRole === "developer" ||
    normalizedRole === "super_admin" ||
    (normalizedRole === "admin" &&
      ((scope.adminRoutes ?? []) as string[]).some((route) => route === "reports.weekly" || route === "reports.other"))
  if (!isGlobalReportsEditor) {
    const normalizedReportDept = normalizeDepartmentName(report.department)
    const canMutate = scope.managedDepartments.some((department) =>
      getDepartmentAliases(department).includes(normalizedReportDept)
    )
    if (!canMutate) return NextResponse.json({ error: "You can only modify reports you created" }, { status: 403 })
  }

  const lock = await fetchWeeklyReportLockState(supabase, report.week_number, report.year)
  if (lock.isLocked) {
    return NextResponse.json({ error: "This report week is locked. Delete is no longer allowed." }, { status: 409 })
  }

  const { error } = await db.from("weekly_reports").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
