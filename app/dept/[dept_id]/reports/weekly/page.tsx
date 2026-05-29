import { createClient } from "@/lib/supabase/server"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { WeeklyReportsContent } from "@/app/admin/reports/weekly-reports/weekly-reports-content"

interface DeptWeeklyReportsPageProps {
  params: Promise<{ dept_id: string }>
}

export default async function DeptWeeklyReportsPage({ params }: DeptWeeklyReportsPageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()

  const deptName = normalizeDepartmentName(scope.deptName)

  // Fetch all departments for the selector (display-only; edits are gated to this dept)
  const { data: employeeData } = await supabase.from("profiles").select("department").not("department", "is", null)

  const departments = Array.from(new Set((employeeData || []).map((row) => row.department).filter(Boolean))) as string[]
  departments.sort()

  return (
    <WeeklyReportsContent
      initialDepartments={departments}
      scopedDepartments={[deptName]}
      editableDepartments={[deptName]}
      currentUser={{
        id: authData.user?.id ?? scope.userId,
        role: scope.role,
        department: scope.deptName,
        is_department_lead: true,
        lead_departments: [scope.deptName],
        admin_domains: [],
      }}
    />
  )
}
