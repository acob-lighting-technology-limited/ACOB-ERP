import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { FinanceReportsPage as AdminAccountsReportsPage } from "@/app/admin/accounts/reports/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAccountsReportsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)
  return <AdminAccountsReportsPage backLinkHref={`/dept/${dept_id}/accounts`} lockedDepartment={scope.deptName} />
}
