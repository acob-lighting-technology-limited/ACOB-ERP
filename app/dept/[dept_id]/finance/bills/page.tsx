import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { BillsPage as AdminFinanceBillsPage } from "@/app/admin/finance/bills/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinanceBillsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminFinanceBillsPage backLinkHref={`/dept/${dept_id}/finance`} financeBasePath={`/dept/${dept_id}/finance`} />
  )
}
