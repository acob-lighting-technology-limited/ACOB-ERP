import { NextResponse } from "next/server"
import { requireApiAdminScope, getScopedDepartments } from "@/lib/admin/api-scope"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { isAssignableEmploymentStatus } from "@/lib/workforce/assignment-policy"

export const dynamic = "force-dynamic"

type DepartmentEmployee = {
  id: string
  first_name: string | null
  last_name: string | null
  company_email: string | null
  additional_email: string | null
  designation: string | null
  employment_status: string | null
  department: string | null
}

// Departments admin screen: department list + employee counts + whether the
// caller can manage (create/edit) departments. Create/update/delete continue
// to go through the existing /api/departments[/[id]] routes.
export async function GET() {
  const scopeResult = await requireApiAdminScope()
  if (!scopeResult.ok) return scopeResult.response
  const { scope, supabase } = scopeResult
  const db = getServiceRoleClientOrFallback(supabase)

  const canManageDepartments = scope.isAdminLike && scope.scopeMode !== "lead"

  let query = db.from("departments").select("*").eq("is_active", true).order("name")
  const depts = getScopedDepartments(scope)
  if (depts !== null) {
    query = depts.length > 0 ? query.in("name", depts) : query.eq("name", "__none__")
  }
  const { data: departments, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: profiles } = await db
    .from("profiles")
    .select("id, first_name, last_name, company_email, additional_email, designation, employment_status, department")

  const employeesByDepartment: Record<string, DepartmentEmployee[]> = {}
  for (const profile of ((profiles ?? []) as DepartmentEmployee[]).filter((employee) =>
    isAssignableEmploymentStatus(employee.employment_status, { allowLegacyNullStatus: false })
  )) {
    const departmentName = profile.department || "Unassigned"
    if (!employeesByDepartment[departmentName]) employeesByDepartment[departmentName] = []
    employeesByDepartment[departmentName].push(profile)
  }

  const scopedDepartmentNames = new Set((departments ?? []).map((d) => d.name))
  const filteredEmployeesByDepartment = Object.fromEntries(
    Object.entries(employeesByDepartment).filter(([name]) => scopedDepartmentNames.has(name))
  )

  const departmentsWithCounts = (departments ?? []).map((department) => ({
    ...department,
    employee_count: filteredEmployeesByDepartment[department.name]?.length || 0,
  }))

  return NextResponse.json({
    departments: departmentsWithCounts,
    departmentEmployees: filteredEmployeesByDepartment,
    canManageDepartments,
  })
}
