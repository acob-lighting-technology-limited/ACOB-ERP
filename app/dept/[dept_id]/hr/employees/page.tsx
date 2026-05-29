import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { AdminEmployeeContent, type Employee, type UserProfile } from "@/app/admin/hr/employees/admin-employee-content"
import type { UserRole } from "@/types/database"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptEmployeesPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const userProfile: UserProfile = {
    role: scope.role as UserRole,
    is_department_lead: true,
    managed_departments: [deptName],
  }

  const { data: employeeData } = await dataClient
    .from("profiles")
    .select("*")
    .in("department", expandedDepts)
    .order("last_name", { ascending: true })

  return <AdminEmployeeContent initialEmployees={(employeeData || []) as Employee[]} userProfile={userProfile} />
}
