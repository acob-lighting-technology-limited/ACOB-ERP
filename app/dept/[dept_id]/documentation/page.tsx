import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { expandDepartmentScopeForQuery } from "@/lib/admin/rbac"
import { normalizeDepartmentName } from "@/shared/departments"
import { PageWrapper, PageHeader, Section } from "@/components/layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, FolderOpen } from "lucide-react"
import Link from "next/link"

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

  const base = `/dept/${dept_id}/documentation`

  return (
    <PageWrapper maxWidth="full" background="gradient">
      <PageHeader
        title="Documentation"
        description="Manage internal writeups and department file repository."
        icon={FileText}
      />
      <Section title="Documentation Sections">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Internal Documentation
              </CardTitle>
              <CardDescription>Knowledge docs, writeups, and employee-created documentation.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${base}/internal`}>
                <Button className="w-full">Open Internal Docs ({docsCount ?? 0})</Button>
              </Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5" />
                Department Documents
              </CardTitle>
              <CardDescription>Confidential department files stored in OneDrive.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={`${base}/department`}>
                <Button className="w-full" variant="outline">
                  Open Department Documents
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </Section>
    </PageWrapper>
  )
}
