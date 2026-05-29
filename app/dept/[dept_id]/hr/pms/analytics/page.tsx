import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { PmsAnalyticsPage as AdminPmsAnalyticsPage } from "@/app/admin/hr/pms/analytics/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsAnalyticsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsAnalyticsPage backLinkHref={`/dept/${dept_id}/hr/pms`} />
}
