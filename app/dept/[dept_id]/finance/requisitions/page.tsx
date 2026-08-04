import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { DeptRequisitionsContent } from "./dept-requisitions-content"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptFinanceRequisitionsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)

  return <DeptRequisitionsContent deptId={dept_id} deptName={scope.deptName} userId={scope.userId} />
}
