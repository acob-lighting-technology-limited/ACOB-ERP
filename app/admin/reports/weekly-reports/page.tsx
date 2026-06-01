import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { WeeklyReportsContent } from "./weekly-reports-content"
import { resolveAdminScope } from "@/lib/admin/rbac"

export default async function WeeklyReportsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    redirect("/auth/login")
  }

  const scope = await resolveAdminScope(supabase, user.id)
  if (!scope) {
    redirect("/profile")
  }

  const { data: employeeData } = await supabase.from("profiles").select("department").not("department", "is", null)

  const departments = Array.from(new Set((employeeData || []).map((row) => row.department).filter(Boolean))) as string[]
  departments.sort()

  return (
    <WeeklyReportsContent
      initialDepartments={departments}
      scopedDepartments={[]}
      editableDepartments={scope.isAdminLike ? [] : scope.managedDepartments || []}
      currentUser={{
        id: user.id,
        role: scope.role,
        department: scope.department,
        is_department_lead: scope.isDepartmentLead,
        lead_departments: scope.leadDepartments,
        admin_routes: scope.adminRoutes,
      }}
    />
  )
}
