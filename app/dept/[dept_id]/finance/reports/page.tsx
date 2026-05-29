import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminFinanceReportsPage from "@/app/admin/finance/reports/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinanceReportsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminFinanceReportsPage backLinkHref={`/dept/${dept_id}/finance`} />
}
