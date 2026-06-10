import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { DocumentationSections } from "@/app/admin/documentation/documentation-sections"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptDocumentationPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)
  const expandedDepts = expandDepartmentScopeForQuery([deptName])

  const { data: deptUsers } =
    expandedDepts.length > 0
      ? await dataClient.from("profiles").select("id").in("department", expandedDepts)
      : { data: [] as { id: string }[] }

  const userIds = (deptUsers || []).map((u) => u.id)

  const { count: docsCount } =
    userIds.length > 0
      ? await dataClient.from("user_documentation").select("*", { count: "exact", head: true }).in("user_id", userIds)
      : { count: 0 }

  return (
    <DocumentationSections
      basePath={`/dept/${dept_id}/documentation`}
      documentationCount={docsCount ?? 0}
      departmentDocsEnabled={true}
      backLink={{ href: `/dept/${dept_id}`, label: "Back to Department" }}
    />
  )
}
