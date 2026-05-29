import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AttendanceReportsPage as AdminAttendancePage } from "@/app/admin/hr/attendance/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAttendancePage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminAttendancePage backLinkHref={`/dept/${dept_id}/hr`} />
}
