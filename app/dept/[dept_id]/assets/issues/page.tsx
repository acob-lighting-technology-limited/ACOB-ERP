import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminAssetIssuesPage from "@/app/admin/assets/issues/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAssetIssuesPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminAssetIssuesPage backLinkHref={`/dept/${dept_id}/assets`} />
}
