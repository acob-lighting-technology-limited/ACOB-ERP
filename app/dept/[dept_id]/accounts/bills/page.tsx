import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { BillsPage as AdminAccountsBillsPage } from "@/app/admin/accounts/bills/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAccountsBillsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminAccountsBillsPage backLinkHref={`/dept/${dept_id}/accounts`} financeBasePath={`/dept/${dept_id}/accounts`} />
  )
}
