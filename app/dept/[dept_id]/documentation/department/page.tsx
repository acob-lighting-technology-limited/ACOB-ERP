import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { resolveOneDriveAccessScope } from "@/lib/onedrive/access"
import { AdminDocumentationContent } from "@/app/admin/documentation/admin-documentation-content"
import type { UserProfile, employeeMember } from "@/app/admin/documentation/admin-documentation-content"
import type { UserRole } from "@/types/database"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptDepartmentDocumentsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const userProfile: UserProfile = {
    role: scope.role as UserRole,
    lead_departments: [deptName],
    managed_departments: [deptName],
  }

  const { data: employeeData } =
    expandedDepts.length > 0
      ? await dataClient
          .from("profiles")
          .select("id, first_name, last_name, department")
          .in("department", expandedDepts)
          .order("last_name", { ascending: true })
      : { data: [] }

  const { data: authData } = await supabase.auth.getUser()
  const oneDriveScope = authData.user ? await resolveOneDriveAccessScope(supabase, authData.user.id) : null

  return (
    <AdminDocumentationContent
      initialDocumentation={[]}
      initialemployee={(employeeData || []) as employeeMember[]}
      userProfile={userProfile}
      departmentDocs={
        oneDriveScope
          ? {
              initialPath: oneDriveScope.defaultPath,
              rootLabel: oneDriveScope.rootLabel,
              enabled: true,
              lockToInitialPath: !oneDriveScope.isAdminLike,
              accessMode: "admin",
            }
          : {
              initialPath: "/",
              rootLabel: "Department Libraries",
              enabled: false,
              lockToInitialPath: false,
              accessMode: "admin",
            }
      }
      defaultTab="department-documents"
      hideTabList={true}
      backLinkHref={`/dept/${dept_id}/documentation`}
      backLinkLabel="Back to Documentation"
    />
  )
}
