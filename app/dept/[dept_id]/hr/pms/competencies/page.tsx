import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminCompetenciesPage as AdminPmsCompetenciesPage } from "@/app/admin/hr/pms/competencies/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsCompetenciesPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsCompetenciesPage backLinkHref={`/dept/${dept_id}/hr/pms`} />
}
