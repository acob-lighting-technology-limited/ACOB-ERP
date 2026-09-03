import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminAccountsPage } from "@/app/admin/accounts/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAccountsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminAccountsPage basePath={`/dept/${dept_id}`} lockedDepartmentId={dept_id} />
}
