import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import AdminAttendanceRecordsPage from "@/app/admin/hr/attendance/records/page"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptAttendanceRecordsPage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return <AdminAttendanceRecordsPage backLinkHref={`/dept/${dept_id}/hr/attendance`} />
}
