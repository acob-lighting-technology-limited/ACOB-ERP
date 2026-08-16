import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminPmsCbtPage from "@/app/admin/hr/pms/cbt/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsCbtPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsCbtPage deptId={dept_id} />
}
