import { redirect } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { AdminEmployeeContent, type Employee, type UserProfile } from "./admin-employee-content"
import { resolveAdminScope, expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { logger } from "@/lib/logger"
import type { Database, UserRole } from "@/types/database"

const log = logger("admin-employees")

async function getAdminEmployeeData() {
  const supabase = await createClient()
  const typedSupabase = supabase as SupabaseClient<Database>
  const dataClient = getServiceRoleClientOrFallback(typedSupabase)

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return { redirect: "/auth/login" as const }
  }

  const scope = await resolveAdminScope(typedSupabase, user.id)
  if (!scope) {
    return { redirect: "/profile" as const }
  }
  const userProfile: UserProfile = {
    role: scope.role as UserRole,
    is_department_lead: scope.isDepartmentLead,
    managed_departments: scope.managedDepartments,
  }

  // Build the employee query, scoping to managed departments for leads
  let query = dataClient.from("profiles").select("*").order("last_name", { ascending: true })

  // Leads in lead mode only see their departments; super admins / global mode see all
  if (!scope.isAdminLike || scope.scopeMode === "lead") {
    if (scope.isDepartmentLead && scope.managedDepartments.length > 0) {
      const expandedDepts = expandDepartmentScopeForQuery(scope.managedDepartments)
      if (expandedDepts.length > 0) {
        query = query.in("department", expandedDepts)
      } else {
        // Lead with no valid dept mappings — return empty list
        return { employees: [], userProfile }
      }
    }
  }

  const { data: employeeData, error: employeeError } = await query

  if (employeeError) {
    log.error({ err: employeeError }, "Error loading employees")
    return { employees: [], userProfile }
  }

  return {
    employees: (employeeData || []) as Employee[],
    userProfile,
  }
}

export default async function AdminEmployeePage() {
  const data = await getAdminEmployeeData()

  if ("redirect" in data && data.redirect) {
    redirect(data.redirect)
  }

  const pageData = data as {
    employees: Employee[]
    userProfile: UserProfile
  }

  return <AdminEmployeeContent initialEmployees={pageData.employees} userProfile={pageData.userProfile} />
}
