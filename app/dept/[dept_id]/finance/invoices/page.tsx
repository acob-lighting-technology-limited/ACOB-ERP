import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminFinanceInvoicesPage from "@/app/admin/finance/invoices/page"

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
