import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { FinanceDashboardContent } from "@/app/admin/finance/finance-dashboard-content"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinancePage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <FinanceDashboardContent basePath={`/dept/${dept_id}`} />
}
