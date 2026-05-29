import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { InvoicesPage as AdminFinanceInvoicesPage } from "@/app/admin/finance/invoices/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinanceInvoicesPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminFinanceInvoicesPage backLinkHref={`/dept/${dept_id}/finance`} financeBasePath={`/dept/${dept_id}/finance`} />
  )
}
