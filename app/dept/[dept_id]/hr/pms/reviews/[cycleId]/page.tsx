import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminPmsReviewCyclePage from "@/app/admin/hr/pms/reviews/[cycleId]/page"

interface Props {
  params: Promise<{ dept_id: string; cycleId: string }>
}

export default async function DeptPmsReviewCyclePage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  // AdminPmsReviewCyclePage reads cycleId via useParams() — the dept route
  // exposes the same [cycleId] segment so no params are forwarded.
  return <AdminPmsReviewCyclePage backLinkHref={`/dept/${dept_id}/hr/pms/reviews`} />
}
