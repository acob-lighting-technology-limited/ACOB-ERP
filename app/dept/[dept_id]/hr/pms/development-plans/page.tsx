import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminDevelopmentPlansPage as AdminPmsDevelopmentPlansPage } from "@/app/admin/hr/pms/development-plans/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsDevelopmentPlansPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsDevelopmentPlansPage backLinkHref={`/dept/${dept_id}/hr/pms`} />
}
