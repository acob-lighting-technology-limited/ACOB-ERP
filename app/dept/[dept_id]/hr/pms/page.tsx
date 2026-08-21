import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsPage } from "@/app/admin/hr/pms/view"

interface Props {
  params: Promise<{ dept_id: string }>
  searchParams: Promise<{ cycle_id?: string }>
}

export default async function DeptPmsPage({ params, searchParams }: Props) {
  const { dept_id } = await params
  const { cycle_id } = await searchParams
  await requireDeptScope(dept_id)
  return <AdminPmsPage basePath={`/dept/${dept_id}`} cycleId={cycle_id} />
}
