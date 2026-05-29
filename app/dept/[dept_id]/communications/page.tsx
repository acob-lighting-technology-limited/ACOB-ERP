import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminCommunicationsPage from "@/app/admin/communications/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptCommunicationsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminCommunicationsPage basePath={`/dept/${dept_id}`} />
}
