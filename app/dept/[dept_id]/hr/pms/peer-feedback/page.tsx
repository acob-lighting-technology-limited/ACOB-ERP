import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminPmsPeerFeedbackPage from "@/app/admin/hr/pms/peer-feedback/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsPeerFeedbackPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminPmsPeerFeedbackPage backLinkHref={`/dept/${dept_id}/hr/pms`} />
}
