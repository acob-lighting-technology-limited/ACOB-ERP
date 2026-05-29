import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsPage } from "@/app/admin/hr/pms/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsPage basePath={`/dept/${dept_id}`} />
}
