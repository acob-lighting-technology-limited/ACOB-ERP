import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsKpiPage } from "@/app/admin/hr/pms/kpi/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsKpiPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminPmsKpiPage backLinkHref={`/dept/${dept_id}/hr/pms`} attendanceBasePath={`/dept/${dept_id}/hr/attendance`} />
  )
}
