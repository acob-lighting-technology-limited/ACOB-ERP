import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { ReviewCyclesPage as AdminPmsCyclesPage } from "@/app/admin/hr/pms/cycles/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsCyclesPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsCyclesPage backLinkHref={`/dept/${dept_id}/hr/pms`} />
}
