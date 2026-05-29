import { requireDeptScope } from "@/lib/dept/require-dept-scope"
import { AdminPmsAttendancePage } from "@/app/admin/hr/pms/attendance/view"

interface Props {
  params: Promise<{ dept_id: string }>
}

export default async function DeptPmsAttendancePage({ params }: Props) {
  const { dept_id } = await params
  await requireDeptScope(dept_id)
  return (
    <AdminPmsAttendancePage
      backLinkHref={`/dept/${dept_id}/hr/pms`}
      attendanceBasePath={`/dept/${dept_id}/hr/attendance`}
    />
  )
}
