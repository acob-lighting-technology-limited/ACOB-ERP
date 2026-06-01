import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminDailyActivityPage } from "@/app/admin/hr/reports/daily-activity/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptDailyActivityPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminDailyActivityPage backLinkHref={`/dept/${dept_id}/hr`} />
}
