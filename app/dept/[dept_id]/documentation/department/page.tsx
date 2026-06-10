import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { departmentToLibraryKey } from "@/lib/onedrive/access"
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

  const departmentPath = `/${departmentToLibraryKey(deptName)}`

  return (
    <AdminDocumentationContent
      initialDocumentation={[]}
      initialemployee={(employeeData || []) as employeeMember[]}
      userProfile={userProfile}
      departmentDocs={{
        initialPath: departmentPath,
        rootLabel: deptName,
        enabled: true,
        lockToInitialPath: true,
        accessMode: "admin",
        lockedDepartment: deptName,
      }}
      defaultTab="department-documents"
      hideTabList={true}
      backLinkHref={`/dept/${dept_id}/documentation`}
      backLinkLabel="Back to Documentation"
    />
  )
}
