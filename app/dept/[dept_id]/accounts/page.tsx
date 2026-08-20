import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AccountsDashboardContent } from "@/app/admin/accounts/accounts-dashboard-content"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAccountsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AccountsDashboardContent basePath={`/dept/${dept_id}`} lockedDepartmentId={dept_id} />
}
