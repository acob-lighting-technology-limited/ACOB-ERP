import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { CbtQuestionManager } from "@/components/pms/cbt-question-manager"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsCbtQuestionPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)
  return <CbtQuestionManager basePath={`/dept/${dept_id}/hr/pms/cbt`} lockDepartment={scope.deptName} />
}
