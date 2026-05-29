import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { AdminDocumentationContent } from "@/app/admin/documentation/admin-documentation-content"
import type { Documentation, UserProfile, employeeMember } from "@/app/admin/documentation/admin-documentation-content"
import type { UserRole } from "@/types/database"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptInternalDocumentationPage({ params }: Props) {
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

  const { data: deptUsers } =
    expandedDepts.length > 0
      ? await dataClient.from("profiles").select("id").in("department", expandedDepts)
      : { data: [] as { id: string }[] }

  const userIds = (deptUsers || []).map((u) => u.id)

  const { data: docsData } =
    userIds.length > 0
      ? await dataClient
          .from("user_documentation")
          .select("*")
          .in("user_id", userIds)
          .order("created_at", { ascending: false })
      : { data: [] }

  const { data: employeeData } =
    expandedDepts.length > 0
      ? await dataClient
          .from("profiles")
          .select("id, first_name, last_name, department")
          .in("department", expandedDepts)
          .order("last_name", { ascending: true })
      : { data: [] }

  let documentation: Documentation[] = []
  if (docsData && docsData.length > 0) {
    const uniqueUserIds = Array.from(new Set(docsData.map((d) => d.user_id).filter(Boolean)))
    const { data: usersData } = await dataClient
      .from("profiles")
      .select("id, first_name, last_name, company_email, department, role")
      .in("id", uniqueUserIds)
    const usersMap = new Map((usersData || []).map((p) => [p.id, p]))
    documentation = docsData.map((doc) => ({
      ...doc,
      user: doc.user_id ? usersMap.get(doc.user_id) : undefined,
    })) as Documentation[]
  }

  return (
    <AdminDocumentationContent
      initialDocumentation={documentation}
      initialemployee={(employeeData || []) as employeeMember[]}
      userProfile={userProfile}
      departmentDocs={{
        initialPath: "/",
        rootLabel: "Department Libraries",
        enabled: false,
        lockToInitialPath: false,
        accessMode: "admin",
      }}
      defaultTab="knowledge-docs"
      hideTabList={true}
      backLinkHref={`/dept/${dept_id}/documentation`}
      backLinkLabel="Back to Documentation"
    />
  )
}
