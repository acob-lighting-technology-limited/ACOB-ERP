import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { FinanceReportsPage as AdminFinanceReportsPage } from "@/app/admin/finance/reports/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinanceReportsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)
  return <AdminFinanceReportsPage backLinkHref={`/dept/${dept_id}/finance`} lockedDepartment={scope.deptName} />
}
