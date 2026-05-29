import { createClient } from "@/lib/supabase/server"
import { getServiceRoleClientOrFallback } from "@/lib/supabase/admin"
import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { normalizeDepartmentName } from "@/shared/departments"
import { AdminReferenceGeneratorContent } from "@/app/admin/tools/reference-generator/admin-reference-generator-content"
import type { CorrespondenceRecord } from "@/types/correspondence"

interface DeptCorrespondencePageProps {
  params: Promise<{ dept_id: string }>
}

export default async function DeptCorrespondencePage({ params }: DeptCorrespondencePageProps) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  const supabase = await createClient()
  const dataClient = getServiceRoleClientOrFallback(supabase)

  const deptName = normalizeDepartmentName(scope.deptName)

  const { data: records } = await dataClient
    .from("correspondence_records")
    .select("*")
    .order("created_at", { ascending: false })

  const scopedRecords = ((records || []) as CorrespondenceRecord[]).filter(
    (record) =>
      normalizeDepartmentName(record.department_name || "") === deptName ||
      normalizeDepartmentName(record.assigned_department_name || "") === deptName
  )

  return <AdminReferenceGeneratorContent initialRecords={scopedRecords} />
}
