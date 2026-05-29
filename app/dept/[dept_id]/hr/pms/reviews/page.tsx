import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsReviewsPage } from "@/app/admin/hr/pms/reviews/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsReviewsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminPmsReviewsPage
      backLinkHref={`/dept/${dept_id}/hr/pms`}
      reviewCycleBasePath={`/dept/${dept_id}/hr/pms/reviews`}
    />
  )
}
