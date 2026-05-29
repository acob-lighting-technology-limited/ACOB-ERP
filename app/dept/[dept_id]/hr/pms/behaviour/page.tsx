import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsBehaviourPage } from "@/app/admin/hr/pms/behaviour/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsBehaviourPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminPmsBehaviourPage
      backLinkHref={`/dept/${dept_id}/hr/pms`}
      attendanceBasePath={`/dept/${dept_id}/hr/attendance`}
    />
  )
}
