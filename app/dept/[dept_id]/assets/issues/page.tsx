import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AssetIssuesPage as AdminAssetIssuesPage } from "@/app/admin/assets/issues/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAssetIssuesPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminAssetIssuesPage backLinkHref={`/dept/${dept_id}/assets`} />
}
