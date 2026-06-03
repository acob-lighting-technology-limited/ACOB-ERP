import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminAttendanceRecordsPage } from "@/app/admin/hr/attendance/records/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAttendanceRecordsPage({ params }: Props) {
  const { dept_id } = await params
  const scope = await requireDeptScope(dept_id)
  return <AdminAttendanceRecordsPage backLinkHref={`/dept/${dept_id}/hr/attendance`} lockedDepartment={scope.deptName} />
}
